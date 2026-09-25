package com.returnos.warehouse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.returnos.ReturnOsApplication;
import java.util.UUID;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;

@SpringBootTest(classes = ReturnOsApplication.class)
@AutoConfigureMockMvc
class WarehouseIntegrationTest {
  static final PostgreSQLContainer<?> postgres;
  static {
    String externalUrl = System.getenv("TEST_DB_URL");
    if (externalUrl == null || externalUrl.isBlank()) {
      postgres = new PostgreSQLContainer<>("postgres:16-alpine");
      postgres.start();
    } else {
      postgres = null;
    }
  }
  @DynamicPropertySource static void database(DynamicPropertyRegistry r) {
    String externalUrl = System.getenv("TEST_DB_URL");
    if (externalUrl != null && !externalUrl.isBlank()) {
      r.add("spring.datasource.url", () -> externalUrl);
      r.add("spring.datasource.username", () -> envOr("TEST_DB_USERNAME", "postgres"));
      r.add("spring.datasource.password", () -> System.getenv("TEST_DB_PASSWORD"));
    } else {
      r.add("spring.datasource.url", postgres::getJdbcUrl); r.add("spring.datasource.username", postgres::getUsername); r.add("spring.datasource.password", postgres::getPassword);
    }
    r.add("returnos.jwt-secret", () -> "test-secret-with-at-least-thirty-two-characters");
    r.add("returnos.fulfillment-enabled", () -> "false");
  }
  static String envOr(String name, String fallback) {
    String v = System.getenv(name);
    return (v == null || v.isBlank()) ? fallback : v;
  }
  @Autowired MockMvc http; @Autowired ObjectMapper json; @Autowired JdbcTemplate jdbc; @Autowired PasswordEncoder passwords;
  String opToken, opId, custToken, customer, address, orderId, orderItemId, retId, retNumber;
  String operator(String email,String warehouse) throws Exception {
    String id=UUID.randomUUID().toString();
    jdbc.update("insert into users(id,email,password_hash,full_name,role,active,warehouse_id) values(?,?,?,?, 'WAREHOUSE',true,?)",id,email,passwords.encode("Password123"),"Operator",warehouse);
    return callAs(null,post("/api/v1/auth/login"), "{\"email\":\""+email+"\",\"password\":\"Password123\"}",200).path("token").asText();
  }
  @BeforeEach void seed() throws Exception {
    jdbc.execute("TRUNCATE users CASCADE");
    jdbc.update("delete from inventory_buckets where product_id='p-wh'");
    jdbc.update("delete from products where id='p-wh'");
    jdbc.update("insert into warehouses(id,code,name,city) values('wh-t2','T2-01','Second site','Mumbai') on conflict(id) do nothing");
    opToken=operator("op@example.test","wh-blr-01"); opId=jdbc.queryForObject("select id from users where email='op@example.test'",String.class);
    var signup = callAs(null,post("/api/v1/auth/signup"), "{\"email\":\"buyer@example.test\",\"password\":\"Password123\",\"fullName\":\"Buyer\"}", 201);
    custToken=signup.path("token").asText(); customer=signup.path("user").path("id").asText();
    jdbc.update("insert into products(id,sku,name,price_paise,stock,active) values('p-wh','WH-1','Widget',50000,10,true)");
    jdbc.update("insert into inventory_buckets(warehouse_id,product_id,state,quantity) values('wh-blr-01','p-wh','AVAILABLE',10)");
    var a=callAs(custToken,post("/api/v1/addresses"), "{\"fullName\":\"Buyer\",\"line1\":\"1 Lane\",\"city\":\"Bengaluru\",\"state\":\"Karnataka\",\"postalCode\":\"560001\"}",201); address=a.path("address").path("id").asText();
    callAs(custToken,post("/api/v1/cart"), "{\"productId\":\"p-wh\",\"quantity\":2}",201);
    orderId=callAs(custToken,post("/api/v1/checkout"), "{\"addressId\":\""+address+"\",\"idempotencyKey\":\"wh-"+UUID.randomUUID()+"\"}",201).path("order").path("id").asText();
    jdbc.update("update orders set delivered_at=now() where id=?",orderId);
    orderItemId=jdbc.queryForObject("select id from order_items where order_id=? limit 1",String.class,orderId);
    var created=callAs(custToken,post("/api/v1/returns"), "{\"orderId\":\""+orderId+"\",\"items\":[{\"orderItemId\":\""+orderItemId+"\",\"quantity\":2,\"reasonCode\":\"CHANGED_MIND\"}],\"resolutionType\":\"REFUND\",\"pickupKind\":\"PICKUP\"}",201);
    retId=created.path("ret").path("id").asText(); retNumber=created.path("ret").path("return_number").asText();
  }
  @Test void fullFlowApproveReceiveInspectDisposeResolves() throws Exception {
    assertThat(callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/approve"),null,200).path("approved_at").isNull()).isFalse();
    assertThat(callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/approve"),null,409).path("code").asText()).isEqualTo("ALREADY_APPROVED");
    var received=callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/receive"), "{\"packageCondition\":\"SEALED\",\"receivedQuantity\":2}",201);
    assertThat(received.path("ret").path("status").asText()).isEqualTo("RECEIVED");
    assertThat(jdbc.queryForObject("select quantity from inventory_buckets where warehouse_id='wh-blr-01' and product_id='p-wh' and state='RETURNED'",Integer.class)).isEqualTo(2);
    assertThat(callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/receive"), "{\"packageCondition\":\"SEALED\",\"receivedQuantity\":2}",409).path("code").asText()).isEqualTo("ALREADY_RECEIVED");
    assertThat(callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/inspection/start"),null,201).path("id").isNull()).isFalse();
    String finding="{\"returnItemId\":\""+jdbc.queryForObject("select id from return_items where return_id=?",String.class,retId)+"\",\"result\":\"PASS\",\"productCondition\":\"NEW\",\"packagingCondition\":\"NEW\",\"quantity\":2}";
    var completed=callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/inspection/complete"), "{\"findings\":["+finding+"]}",200);
    assertThat(completed.path("inspection").path("result").asText()).isEqualTo("PASS");
    String disp="{\"returnItemId\":\""+jdbc.queryForObject("select id from return_items where return_id=?",String.class,retId)+"\",\"action\":\"RESTOCK\",\"quantity\":2}";
    var done=callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/disposition"),disp,201);
    assertThat(done.path("returnResolved").asBoolean()).isTrue();
    assertThat(jdbc.queryForObject("select status from refunds where return_id=?",String.class,retId)).isEqualTo("COMPLETED");
    assertThat(jdbc.queryForObject("select stock from products where id='p-wh'",Integer.class)).isEqualTo(10);
    assertThat(jdbc.queryForObject("select quantity from inventory_buckets where warehouse_id='wh-blr-01' and product_id='p-wh' and state='AVAILABLE'",Integer.class)).isEqualTo(10);
    assertThat(jdbc.queryForObject("select count(*) from audit_log where entity_id=?",Integer.class,retId)).isPositive();
  }
  @Test void unapprovedFlowBlocksResolutionUntilApproval() throws Exception {
    callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/receive"), "{\"packageCondition\":\"SEALED\",\"receivedQuantity\":2}",201);
    assertThat(jdbc.queryForObject("select count(*) from warehouse_tasks where return_id=? and kind='REVIEW_APPROVAL' and status in ('TODO','IN_PROGRESS')",Integer.class,retId)).isEqualTo(1);
    callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/inspection/start"),null,201);
    String finding="{\"returnItemId\":\""+jdbc.queryForObject("select id from return_items where return_id=?",String.class,retId)+"\",\"result\":\"PASS\",\"productCondition\":\"NEW\",\"packagingCondition\":\"NEW\",\"quantity\":2}";
    callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/inspection/complete"), "{\"findings\":["+finding+"]}",200);
    String disp="{\"returnItemId\":\""+jdbc.queryForObject("select id from return_items where return_id=?",String.class,retId)+"\",\"action\":\"RESTOCK\",\"quantity\":2}";
    var done=callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/disposition"),disp,201);
    assertThat(done.path("returnResolved").asBoolean()).isFalse();
    assertThat(jdbc.queryForObject("select status from refunds where return_id=?",String.class,retId)).isEqualTo("PENDING");
    callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/approve"),null,200);
    assertThat(jdbc.queryForObject("select status from refunds where return_id=?",String.class,retId)).isEqualTo("COMPLETED");
  }
  @Test void warehouseGuards() throws Exception {
    assertThat(callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/inspection/start"),null,409).path("code").asText()).isEqualTo("NOT_RECEIVED");
    String itemId=jdbc.queryForObject("select id from return_items where return_id=?",String.class,retId);
    assertThat(callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/disposition"), "{\"returnItemId\":\""+itemId+"\",\"action\":\"RESTOCK\",\"quantity\":1}",409).path("code").asText()).isEqualTo("INSPECTION_INCOMPLETE");
    assertThat(callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/receive"), "{\"packageCondition\":\"SEALED\",\"receivedQuantity\":9}",422).path("code").asText()).isEqualTo("QUANTITY_EXCEEDS_EXPECTED");
    assertThat(callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/receive"), "{\"packageCondition\":\"SEALED\",\"receivedQuantity\":1}",422).path("code").asText()).isEqualTo("DISCREPANCY_REQUIRED");
    assertThat(callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/receive"), "{\"packageCondition\":\"BROKEN\",\"receivedQuantity\":2}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/receive"), "{\"packageCondition\":\"SEALED\",\"receivedQuantity\":2}",201);
    callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/inspection/start"),null,201);
    assertThat(callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/inspection/complete"), "{\"findings\":[]}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    String bad="{\"returnItemId\":\""+itemId+"\",\"result\":\"PASS\",\"productCondition\":\"NEW\",\"packagingCondition\":\"NEW\",\"quantity\":2}";
    String dup="{\"findings\":["+bad+","+bad+"]}";
    var oneItem=jdbc.queryForObject("select count(*) from return_items where return_id=?",Integer.class,retId);
    if(oneItem==1)assertThat(callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/inspection/complete"),dup,422).path("code").asText()).isIn("DUPLICATE_FINDING","INCOMPLETE_INSPECTION");
    String finding="{\"returnItemId\":\""+itemId+"\",\"result\":\"PASS\",\"productCondition\":\"NEW\",\"packagingCondition\":\"NEW\",\"quantity\":2}";
    callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/inspection/complete"), "{\"findings\":["+finding+"]}",200);
    assertThat(callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/disposition"), "{\"returnItemId\":\""+itemId+"\",\"action\":\"DISPOSE\",\"quantity\":2}",422).path("code").asText()).isEqualTo("DISPOSITION_NOT_ALLOWED");
    assertThat(callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/disposition"), "{\"returnItemId\":\"missing\",\"action\":\"RESTOCK\",\"quantity\":1}",404).path("code").asText()).isEqualTo("RETURN_ITEM_NOT_FOUND");
    String disp="{\"returnItemId\":\""+itemId+"\",\"action\":\"RESTOCK\",\"quantity\":2}";
    callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/disposition"),disp,201);
    assertThat(callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/disposition"),disp,409).path("code").asText()).isEqualTo("ALREADY_DISPOSED");
  }
  @Test void siteScopingAndAuth() throws Exception {
    assertThat(callAs(custToken,get("/api/v1/warehouse/summary"),null,403).path("code").asText()).isEqualTo("FORBIDDEN");
    assertThat(anon(get("/api/v1/warehouse/summary"),401).path("code").asText()).isEqualTo("UNAUTHORIZED");
    callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/receive"), "{\"packageCondition\":\"SEALED\",\"receivedQuantity\":2}",201);
    String op2=operator("op2@example.test","wh-t2");
    assertThat(callAs(op2,get("/api/v1/warehouse/returns/"+retId),null,404).path("code").asText()).isEqualTo("RETURN_NOT_FOUND");
    assertThat(callAs(op2,post("/api/v1/warehouse/returns/"+retId+"/approve"),null,404).path("code").asText()).isEqualTo("RETURN_NOT_FOUND");
    assertThat(callAs(op2,get("/api/v1/warehouse/returns"),null,200).path("returns").size()).isZero();
  }
  @Test void queueInventoryTasksShipmentsAnalyticsAudit() throws Exception {
    var me=callAs(opToken,get("/api/v1/warehouse/me"),null,200);
    assertThat(me.path("warehouse").path("code").asText()).isEqualTo("BLR-01");
    assertThat(me.path("locations").size()).isPositive();
    callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/approve"),null,200);
    assertThat(callAs(opToken,get("/api/v1/warehouse/returns?status=REQUESTED"),null,200).path("total").asInt()).isPositive();
    var queue=callAs(opToken,get("/api/v1/warehouse/returns"),null,200);
    assertThat(callAs(opToken,get("/api/v1/warehouse/returns?status=REQUESTED&limit=1&offset=0"),null,200).path("returns").size()).isEqualTo(1);
    assertThat(callAs(opToken,get("/api/v1/warehouse/returns?status=REQUESTED&search="+retNumber),null,200).path("total").asInt()).isEqualTo(1);
    var detail=callAs(opToken,get("/api/v1/warehouse/returns/"+retId),null,200);
    for(String k:new String[]{"summary","lines","receiving","inspection","dispositions","timeline","documents","audit"})assertThat(detail.has(k)).isTrue();
    assertThat(detail.path("inspection").isNull()).isTrue();
    callAs(opToken,post("/api/v1/warehouse/returns/"+retId+"/receive"), "{\"packageCondition\":\"SEALED\",\"receivedQuantity\":2}",201);
    queue=callAs(opToken,get("/api/v1/warehouse/returns"),null,200);
    assertThat(queue.path("total").asInt()).isPositive();
    assertThat(queue.path("returns").get(0).path("customerRef").asText()).startsWith("CUS-");
    var inv=callAs(opToken,get("/api/v1/warehouse/inventory"),null,200);
    assertThat(inv.path("total").asInt()).isPositive();
    assertThat(inv.path("inventory").get(0).has("sellableStock")).isTrue();
    assertThat(callAs(opToken,get("/api/v1/warehouse/inventory?search=WH-1"),null,200).path("total").asInt()).isPositive();
    var one=callAs(opToken,get("/api/v1/warehouse/inventory/p-wh"),null,200);
    assertThat(one.path("product").path("stock").asInt()).isEqualTo(8);
    assertThat(callAs(opToken,get("/api/v1/warehouse/inventory/missing"),null,404).path("code").asText()).isEqualTo("PRODUCT_NOT_FOUND");
    var moves=callAs(opToken,get("/api/v1/warehouse/inventory-movements?reason=ADJUSTMENT"),null,200);
    assertThat(moves.path("total").asInt()).isPositive();
    var summary=callAs(opToken,get("/api/v1/warehouse/summary"),null,200);
    for(String k:new String[]{"awaitingArrival","pendingInspection","inInspection","pendingApproval","resolved","overdue","movementsToday","tasks","overdueTasks","warnings"})assertThat(summary.has(k)).isTrue();
    var tasks=callAs(opToken,get("/api/v1/warehouse/tasks"),null,200);
    assertThat(tasks.path("total").asInt()).isPositive();
    String taskId=tasks.path("tasks").get(0).path("id").asText();
    assertThat(callAs(opToken,patch("/api/v1/warehouse/tasks/"+taskId),"{}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    var claimed=callAs(opToken,post("/api/v1/warehouse/tasks/"+taskId+"/claim"),null,200);
    assertThat(claimed.path("task").path("status").asText()).isEqualTo("IN_PROGRESS");
    var blocked=callAs(opToken,patch("/api/v1/warehouse/tasks/"+taskId),"{\"status\":\"BLOCKED\"}",422);
    assertThat(blocked.path("code").asText()).isEqualTo("BLOCKED_REASON_REQUIRED");
    var done=callAs(opToken,patch("/api/v1/warehouse/tasks/"+taskId),"{\"status\":\"COMPLETED\"}",200);
    assertThat(done.path("task").path("status").asText()).isEqualTo("COMPLETED");
    assertThat(callAs(opToken,patch("/api/v1/warehouse/tasks/"+taskId),"{\"status\":\"TODO\"}",409).path("code").asText()).isEqualTo("TASK_COMPLETED");
    assertThat(callAs(opToken,patch("/api/v1/warehouse/tasks/missing"),"{\"status\":\"TODO\"}",404).path("code").asText()).isEqualTo("TASK_NOT_FOUND");
    var ships=callAs(opToken,get("/api/v1/warehouse/shipments"),null,200);
    assertThat(ships.path("total").asInt()).isPositive();assertThat(ships.has("recentReceiving")).isTrue();
    var analytics=callAs(opToken,get("/api/v1/warehouse/analytics"),null,200);
    for(String k:new String[]{"windowDays","returnsReceived","inspectionsCompleted","dispositionsByAction","movementsByReason","overdueTasks","warnings"})assertThat(analytics.has(k)).isTrue();
    var audit=callAs(opToken,get("/api/v1/warehouse/audit"),null,200);
    assertThat(audit.path("total").asInt()).isPositive();
    assertThat(callAs(opToken,get("/api/v1/warehouse/audit?entityType=RETURN&entityId="+retId),null,200).path("total").asInt()).isPositive();
  }
  String[] freshOrder() throws Exception {
    callAs(custToken,post("/api/v1/cart"), "{\"productId\":\"p-wh\",\"quantity\":2}",201);
    String o=callAs(custToken,post("/api/v1/checkout"), "{\"addressId\":\""+address+"\",\"idempotencyKey\":\"wh-"+UUID.randomUUID()+"\"}",201).path("order").path("id").asText();
    jdbc.update("update orders set delivered_at=now() where id=?",o);
    return new String[]{o,jdbc.queryForObject("select id from order_items where order_id=? limit 1",String.class,o)};
  }
  String fullFlowToDisposition(String resolution,String reason,String findingResult,String action) throws Exception {
    String[] oo=freshOrder();
    String r=callAs(custToken,post("/api/v1/returns"), "{\"orderId\":\""+oo[0]+"\",\"items\":[{\"orderItemId\":\""+oo[1]+"\",\"quantity\":2,\"reasonCode\":\""+reason+"\"}],\"resolutionType\":\""+resolution+"\",\"pickupKind\":\"PICKUP\"}",201).path("ret").path("id").asText();
    callAs(opToken,post("/api/v1/warehouse/returns/"+r+"/approve"),null,200);
    callAs(opToken,post("/api/v1/warehouse/returns/"+r+"/receive"), "{\"packageCondition\":\"SEALED\",\"receivedQuantity\":2}",201);
    callAs(opToken,post("/api/v1/warehouse/returns/"+r+"/inspection/start"),null,201);
    String item=jdbc.queryForObject("select id from return_items where return_id=?",String.class,r);
    String f="{\"returnItemId\":\""+item+"\",\"result\":\""+findingResult+"\",\"productCondition\":\"NEW\",\"packagingCondition\":\"NEW\",\"quantity\":2}";
    callAs(opToken,post("/api/v1/warehouse/returns/"+r+"/inspection/complete"), "{\"findings\":["+f+"]}",200);
    var done=callAs(opToken,post("/api/v1/warehouse/returns/"+r+"/disposition"), "{\"returnItemId\":\""+item+"\",\"action\":\""+action+"\",\"quantity\":2}",201);
    assertThat(done.path("returnResolved").asBoolean()).isTrue();
    return r;
  }
  @Test void storeCreditAndReplacementResolveThroughSinglePath() throws Exception {
    String sc=fullFlowToDisposition("STORE_CREDIT","CHANGED_MIND","PASS","RESTOCK");
    assertThat(jdbc.queryForObject("select status from refunds where return_id=?",String.class,sc)).isEqualTo("COMPLETED");
    assertThat(jdbc.queryForObject("select status from returns where id=?",String.class,sc)).isEqualTo("RESOLVED");
    var ledger=jdbc.queryForObject("select amount_paise from store_credit_ledger where reference_type='RETURN' and reference_id=?",Integer.class,sc);
    assertThat(ledger).isEqualTo(100000);
    assertThat(jdbc.queryForObject("select count(*) from notifications where user_id=? and type='RETURN_RESOLVED'",Integer.class,customer)).isEqualTo(1);
    String rp=fullFlowToDisposition("REPLACEMENT","DEFECTIVE","DEFECTIVE","RECYCLE");
    assertThat(jdbc.queryForObject("select status from refunds where return_id=?",String.class,rp)).isEqualTo("COMPLETED");
    String repl=jdbc.queryForObject("select id from orders where source_return_id=?",String.class,rp);
    assertThat(jdbc.queryForObject("select status from orders where id=?",String.class,repl)).isEqualTo("PROCESSING");
    assertThat(jdbc.queryForObject("select count(*) from order_items where order_id=?",Integer.class,repl)).isPositive();
    assertThat(jdbc.queryForObject("select stock from products where id='p-wh'",Integer.class)).isEqualTo(4);
  }
  private JsonNode callAs(String tok,org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder b,String body,int expected) throws Exception { if(body!=null)b.content(body); var builder=b.contentType(MediaType.APPLICATION_JSON); if(tok!=null)builder.header("Authorization","Bearer "+tok); var result=http.perform(builder).andExpect(status().is(expected)).andReturn(); return json.readTree(result.getResponse().getContentAsString()); }
  private JsonNode anon(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder b,int expected) throws Exception { var result=http.perform(b.contentType(MediaType.APPLICATION_JSON)).andExpect(status().is(expected)).andReturn(); return json.readTree(result.getResponse().getContentAsString()); }
}
