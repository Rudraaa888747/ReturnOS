package com.returnos.admin;

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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.containers.PostgreSQLContainer;

@SpringBootTest(classes = ReturnOsApplication.class)
@AutoConfigureMockMvc
class AdminReadsIntegrationTest {
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
  String adminToken, custToken, customer, orderId, retId, refundId;
  @BeforeEach void seed() throws Exception {
    jdbc.execute("TRUNCATE users CASCADE");
    jdbc.update("delete from inventory_buckets where product_id='p-adm'");
    jdbc.update("delete from products where id='p-adm'");
    String adminId=UUID.randomUUID().toString();
    jdbc.update("insert into users(id,email,password_hash,full_name,role,active) values(?,?,?,?,'ADMIN',true)",adminId,"admin@example.test",passwords.encode("Password123"),"Admin");
    adminToken=callAs(null,post("/api/v1/auth/login"), "{\"email\":\"admin@example.test\",\"password\":\"Password123\"}",200).path("token").asText();
    var signup=callAs(null,post("/api/v1/auth/signup"), "{\"email\":\"shopper@example.test\",\"password\":\"Password123\",\"fullName\":\"Shopper\"}",201);
    custToken=signup.path("token").asText(); customer=signup.path("user").path("id").asText();
    jdbc.update("insert into products(id,sku,name,price_paise,stock,active) values('p-adm','ADM-1','Admin Item',75000,10,true)");
    jdbc.update("insert into inventory_buckets(warehouse_id,product_id,state,quantity) values('wh-blr-01','p-adm','AVAILABLE',10)");
    var a=callAs(custToken,post("/api/v1/addresses"), "{\"fullName\":\"Shopper\",\"line1\":\"1 Lane\",\"city\":\"Bengaluru\",\"state\":\"Karnataka\",\"postalCode\":\"560001\"}",201);
    String address=a.path("address").path("id").asText();
    callAs(custToken,post("/api/v1/cart"), "{\"productId\":\"p-adm\",\"quantity\":1}",201);
    orderId=callAs(custToken,post("/api/v1/checkout"), "{\"addressId\":\""+address+"\",\"idempotencyKey\":\"adm-"+UUID.randomUUID()+"\"}",201).path("order").path("id").asText();
    jdbc.update("update orders set delivered_at=now() where id=?",orderId);
    String item=jdbc.queryForObject("select id from order_items where order_id=? limit 1",String.class,orderId);
    retId=callAs(custToken,post("/api/v1/returns"), "{\"orderId\":\""+orderId+"\",\"items\":[{\"orderItemId\":\""+item+"\",\"quantity\":1,\"reasonCode\":\"OTHER\"}],\"resolutionType\":\"REFUND\",\"pickupKind\":\"PICKUP\"}",201).path("ret").path("id").asText();
    refundId=jdbc.queryForObject("select id from refunds where return_id=?",String.class,retId);
    jdbc.update("insert into store_credit_ledger(id,user_id,type,amount_paise,reference_type,reference_id) values(?,?, 'CREDIT',25000,'TEST',?)",UUID.randomUUID().toString(),customer,UUID.randomUUID().toString());
    jdbc.update("insert into admin_audit_log(id,actor_id,actor_role,action,entity_type,entity_id) values(?,?, 'ADMIN','TEST_ACTION','ORDER',?)",UUID.randomUUID().toString(),adminId,orderId);
    String opId=UUID.randomUUID().toString();
    jdbc.update("insert into users(id,email,password_hash,full_name,role,active,warehouse_id) values(?,?,?,?,'WAREHOUSE',true,'wh-blr-01')",opId,"admop@example.test",passwords.encode("Password123"),"Op");
  }
  @Test void meAndAuth() throws Exception {
    var me=callAs(adminToken,get("/api/v1/admin/me"),null,200);
    assertThat(me.path("user").path("role").asText()).isEqualTo("ADMIN");
    assertThat(me.path("permissions").size()).isEqualTo(23);
    assertThat(callAs(custToken,get("/api/v1/admin/me"),null,403).path("code").asText()).isEqualTo("ADMIN_REQUIRED");
    assertThat(anon(get("/api/v1/admin/me"),401).path("code").asText()).isEqualTo("UNAUTHORIZED");
  }
  @Test void auditAndSummary() throws Exception {
    assertThat(callAs(adminToken,get("/api/v1/admin/audit"),null,200).path("total").asInt()).isEqualTo(1);
    assertThat(callAs(adminToken,get("/api/v1/admin/audit?action=NOPE"),null,200).path("total").asInt()).isZero();
    assertThat(callAs(adminToken,get("/api/v1/admin/audit?limit=0"),null,400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    var s=callAs(adminToken,get("/api/v1/admin/summary"),null,200);
    for(String k:new String[]{"commerce","returns","financial","warehouse","recovery","customers","pendingReturns","pendingRefunds","warehouseAlerts","overdueTasksList","inventoryIssues","openTickets","recentOrders","recentReturns","recentAdminActivity"})assertThat(s.has(k)).isTrue();
    assertThat(s.path("commerce").path("totalOrders").asInt()).isPositive();
    assertThat(s.path("returns").path("totalReturns").asInt()).isPositive();
  }
  @Test void customersOrdersReturns() throws Exception {
    var c=callAs(adminToken,get("/api/v1/admin/customers?search=shopper"),null,200);
    assertThat(c.path("total").asInt()).isEqualTo(1);
    assertThat(c.path("customers").get(0).path("orders_count").asInt()).isEqualTo(1);
    var cd=callAs(adminToken,get("/api/v1/admin/customers/"+customer),null,200);
    for(String k:new String[]{"user","orders","returns","refunds","credit","tickets","activity"})assertThat(cd.has(k)).isTrue();
    assertThat(cd.path("credit").path("balancePaise").asInt()).isEqualTo(25000);
    assertThat(callAs(adminToken,get("/api/v1/admin/customers/missing"),null,404).path("code").asText()).isEqualTo("CUSTOMER_NOT_FOUND");
    var o=callAs(adminToken,get("/api/v1/admin/orders?status=PLACED"),null,200);
    assertThat(o.path("total").asInt()).isPositive();
    assertThat(callAs(adminToken,get("/api/v1/admin/orders?from=bad-date"),null,400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    var od=callAs(adminToken,get("/api/v1/admin/orders/"+orderId),null,200);
    for(String k:new String[]{"order","customer","items","events","returns","refunds","replacements"})assertThat(od.has(k)).isTrue();
    assertThat(callAs(adminToken,get("/api/v1/admin/orders/missing"),null,404).path("code").asText()).isEqualTo("ORDER_NOT_FOUND");
    var r=callAs(adminToken,get("/api/v1/admin/returns?status=REQUESTED"),null,200);
    assertThat(r.path("total").asInt()).isPositive();
    var rd=callAs(adminToken,get("/api/v1/admin/returns/"+retId),null,200);
    for(String k:new String[]{"ret","customer","order","items","pickup","receiving","inspection","dispositions","refund","ledger","replacements","events","documents","audit"})assertThat(rd.has(k)).isTrue();
    assertThat(callAs(adminToken,get("/api/v1/admin/returns/missing"),null,404).path("code").asText()).isEqualTo("RETURN_NOT_FOUND");
  }
  @Test void warehousesWorkloadInventoryAnalytics() throws Exception {
    var w=callAs(adminToken,get("/api/v1/admin/warehouses"),null,200);
    assertThat(w.path("warehouses").size()).isPositive();
    assertThat(w.path("warehouses").get(0).has("open_tasks")).isTrue();
    var wu=callAs(adminToken,get("/api/v1/admin/warehouse-users"),null,200);
    assertThat(wu.path("total").asInt()).isPositive();
    assertThat(callAs(adminToken,get("/api/v1/admin/warehouse-users?warehouseId=wh-blr-01"),null,200).path("total").asInt()).isPositive();
    var wl=callAs(adminToken,get("/api/v1/admin/workload"),null,200);
    for(String k:new String[]{"returns","returnsTotal","tasks","tasksTotal"})assertThat(wl.has(k)).isTrue();
    var inv=callAs(adminToken,get("/api/v1/admin/inventory?search=ADM-1"),null,200);
    assertThat(inv.path("total").asInt()).isPositive();
    assertThat(inv.path("inventory").get(0).path("buckets").size()).isPositive();
    var mov=callAs(adminToken,get("/api/v1/admin/inventory/movements"),null,200);
    assertThat(mov.path("total").asInt()).isPositive();
    var an=callAs(adminToken,get("/api/v1/admin/analytics"),null,200);
    assertThat(an.path("scope").asText()).isEqualTo("global");
    for(String k:new String[]{"commerce","returns","refunds","credit","inventory","warehouse","recovery","customers","warnings","byWarehouse"})assertThat(an.has(k)).isTrue();
    var site=callAs(adminToken,get("/api/v1/admin/analytics?warehouseId=wh-blr-01"),null,200);
    assertThat(site.path("scope").asText()).isEqualTo("warehouse");
  }
  @Test void refundsAndCredit() throws Exception {
    var rf=callAs(adminToken,get("/api/v1/admin/refunds"),null,200);
    assertThat(rf.path("total").asInt()).isPositive();
    assertThat(callAs(adminToken,get("/api/v1/admin/refunds/"+refundId),null,200).path("refund").path("id").asText()).isEqualTo(refundId);
    assertThat(callAs(adminToken,get("/api/v1/admin/refunds/missing"),null,404).path("code").asText()).isEqualTo("REFUND_NOT_FOUND");
    var lg=callAs(adminToken,get("/api/v1/admin/credit/ledger"),null,200);
    assertThat(lg.path("total").asInt()).isPositive();
    assertThat(lg.path("entries").get(0).has("user_email")).isTrue();
    var bl=callAs(adminToken,get("/api/v1/admin/credit/balances"),null,200);
    assertThat(bl.path("balances").size()).isPositive();
  }
  private JsonNode callAs(String tok,MockHttpServletRequestBuilder b,String body,int expected) throws Exception { if(body!=null){b.content(body);b.contentType(MediaType.APPLICATION_JSON);} if(tok!=null)b.header("Authorization","Bearer "+tok); var result=http.perform(b).andExpect(status().is(expected)).andReturn(); return json.readTree(result.getResponse().getContentAsString()); }
  private JsonNode anon(MockHttpServletRequestBuilder b,int expected) throws Exception { var result=http.perform(b.contentType(MediaType.APPLICATION_JSON)).andExpect(status().is(expected)).andReturn(); return json.readTree(result.getResponse().getContentAsString()); }
}
