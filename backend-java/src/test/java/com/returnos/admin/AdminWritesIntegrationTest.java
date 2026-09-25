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
class AdminWritesIntegrationTest {
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
  String adminToken, adminId, custToken, customer;
  @BeforeEach void seed() throws Exception {
    jdbc.execute("TRUNCATE users CASCADE");
    jdbc.update("delete from return_reasons where code='TEST_NEW'");
    jdbc.update("delete from products where category_id in (select id from categories where name like 'TestCat%')");
    jdbc.update("delete from products where sku like 'AW-%'");
    jdbc.update("delete from categories where name like 'TestCat%'");
    jdbc.update("delete from warehouses where id not in ('wh-blr-01')");
    adminId=UUID.randomUUID().toString();
    jdbc.update("insert into users(id,email,password_hash,full_name,role,active) values(?,?,?,?,'ADMIN',true)",adminId,"root@example.test",passwords.encode("Password123"),"Root");
    adminToken=callAs(null,post("/api/v1/auth/login"), "{\"email\":\"root@example.test\",\"password\":\"Password123\"}",200).path("token").asText();
    var signup=callAs(null,post("/api/v1/auth/signup"), "{\"email\":\"member@example.test\",\"password\":\"Password123\",\"fullName\":\"Member\"}",201);
    custToken=signup.path("token").asText(); customer=signup.path("user").path("id").asText();
  }
  @Test void settingsAndReasons() throws Exception {
    var all=callAs(adminToken,get("/api/v1/admin/settings"),null,200);
    assertThat(all.path("settings").size()).isEqualTo(5);
    assertThat(callAs(adminToken,patch("/api/v1/admin/settings/NOPE"),"{\"value\":1}",400).path("code").asText()).isEqualTo("UNKNOWN_SETTING");
    assertThat(callAs(adminToken,patch("/api/v1/admin/settings/RETURN_WINDOW_DAYS"),"{\"value\":0}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    var upd=callAs(adminToken,patch("/api/v1/admin/settings/RETURN_WINDOW_DAYS"),"{\"value\":45}",200);
    assertThat(upd.path("setting").path("effective").asInt()).isEqualTo(45);
    assertThat(jdbc.queryForObject("select count(*) from admin_audit_log where action='SETTING_UPDATED'",Integer.class)).isEqualTo(1);
    callAs(adminToken,patch("/api/v1/admin/settings/RETURN_WINDOW_DAYS"),"{\"value\":30}",200);
    assertThat(callAs(custToken,get("/api/v1/admin/settings"),null,403).path("code").asText()).isEqualTo("ADMIN_REQUIRED");
    var created=callAs(adminToken,post("/api/v1/admin/return-reasons"),"{\"code\":\"test_new\",\"label\":\"Test New\"}",201);
    assertThat(created.path("reason").path("code").asText()).isEqualTo("TEST_NEW");
    assertThat(callAs(adminToken,post("/api/v1/admin/return-reasons"),"{\"code\":\"TEST_NEW\",\"label\":\"Dup\"}",409).path("code").asText()).isEqualTo("REASON_EXISTS");
    assertThat(callAs(adminToken,post("/api/v1/admin/return-reasons"),"{\"code\":\"1bad\",\"label\":\"x\"}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    var patched=callAs(adminToken,patch("/api/v1/admin/return-reasons/TEST_NEW"),"{\"active\":false}",200);
    assertThat(patched.path("reason").path("active").asBoolean()).isFalse();
    assertThat(callAs(adminToken,patch("/api/v1/admin/return-reasons/MISSING"),"{\"active\":false}",404).path("code").asText()).isEqualTo("REASON_NOT_FOUND");
  }
  @Test void creditAdjustments() throws Exception {
    String key=UUID.randomUUID().toString();
    var first=callAs(adminToken,post("/api/v1/admin/credit/adjustments"),"{\"userId\":\""+customer+"\",\"direction\":\"CREDIT\",\"amountPaise\":10000,\"reason\":\"Goodwill gesture\",\"key\":\""+key+"\"}",201);
    assertThat(first.path("replayed").asBoolean()).isFalse();
    assertThat(first.path("balancePaise").asInt()).isEqualTo(10000);
    var replay=callAs(adminToken,post("/api/v1/admin/credit/adjustments"),"{\"userId\":\""+customer+"\",\"direction\":\"CREDIT\",\"amountPaise\":10000,\"reason\":\"Goodwill gesture\",\"key\":\""+key+"\"}",200);
    assertThat(replay.path("replayed").asBoolean()).isTrue();
    assertThat(jdbc.queryForObject("select count(*) from store_credit_ledger where reference_type='ADMIN_ADJUSTMENT' and reference_id=?",Integer.class,key)).isEqualTo(1);
    assertThat(callAs(adminToken,post("/api/v1/admin/credit/adjustments"),"{\"userId\":\""+customer+"\",\"direction\":\"DEBIT\",\"amountPaise\":99999,\"reason\":\"Too much debit\",\"key\":\""+UUID.randomUUID()+"\"}",409).path("code").asText()).isEqualTo("INSUFFICIENT_CREDIT");
    assertThat(callAs(adminToken,post("/api/v1/admin/credit/adjustments"),"{\"userId\":\""+adminId+"\",\"direction\":\"CREDIT\",\"amountPaise\":10,\"reason\":\"No admin credit\",\"key\":\""+UUID.randomUUID()+"\"}",422).path("code").asText()).isEqualTo("CREDIT_USER_INVALID");
    assertThat(callAs(adminToken,post("/api/v1/admin/credit/adjustments"),"{\"userId\":\"missing\",\"direction\":\"CREDIT\",\"amountPaise\":10,\"reason\":\"No such user here\",\"key\":\""+UUID.randomUUID()+"\"}",404).path("code").asText()).isEqualTo("USER_NOT_FOUND");
    assertThat(callAs(adminToken,post("/api/v1/admin/credit/adjustments"),"{\"userId\":\""+customer+"\",\"direction\":\"CREDIT\",\"amountPaise\":10,\"reason\":\"short\",\"key\":\""+UUID.randomUUID()+"\"}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
  }
  @Test void sitesAndOperators() throws Exception {
    var created=callAs(adminToken,post("/api/v1/admin/warehouses"),"{\"code\":\"tst-99\",\"name\":\"Test Site\",\"city\":\"Goa\"}",201);
    String site=created.path("warehouse").path("id").asText();
    assertThat(created.path("warehouse").path("code").asText()).isEqualTo("TST-99");
    assertThat(callAs(adminToken,post("/api/v1/admin/warehouses"),"{\"code\":\"TST-99\",\"name\":\"Dup\"}",409).path("code").asText()).isEqualTo("WAREHOUSE_CODE_EXISTS");
    var detail=callAs(adminToken,get("/api/v1/admin/warehouses/"+site),null,200);
    assertThat(detail.path("locations").size()).isEqualTo(4);
    assertThat(callAs(adminToken,get("/api/v1/admin/warehouses/missing"),null,404).path("code").asText()).isEqualTo("WAREHOUSE_NOT_FOUND");
    var op=callAs(adminToken,post("/api/v1/admin/warehouse-users"),"{\"email\":\"siteop@example.test\",\"password\":\"Password123\",\"fullName\":\"Site Op\",\"warehouseId\":\""+site+"\"}",201);
    String opId=op.path("user").path("id").asText();
    assertThat(callAs(adminToken,post("/api/v1/admin/warehouse-users"),"{\"email\":\"siteop@example.test\",\"password\":\"Password123\",\"fullName\":\"Dup\",\"warehouseId\":\""+site+"\"}",409).path("code").asText()).isEqualTo("EMAIL_EXISTS");
    assertThat(callAs(adminToken,post("/api/v1/admin/warehouse-users"),"{\"email\":\"x2@example.test\",\"password\":\"Password123\",\"fullName\":\"X\",\"warehouseId\":\"missing\"}",404).path("code").asText()).isEqualTo("WAREHOUSE_NOT_FOUND");
    var patched=callAs(adminToken,patch("/api/v1/admin/warehouse-users/"+opId),"{\"active\":false}",200);
    assertThat(patched.path("user").path("active").asBoolean()).isFalse();
    assertThat(callAs(adminToken,patch("/api/v1/admin/warehouse-users/"+customer),"{\"active\":false}",422).path("code").asText()).isEqualTo("OPERATOR_INVALID_ROLE");
    var dis=callAs(adminToken,patch("/api/v1/admin/warehouses/"+site),"{\"active\":false}",200);
    assertThat(dis.path("warehouse").path("active").asBoolean()).isFalse();
    assertThat(callAs(adminToken,post("/api/v1/admin/warehouse-users"),"{\"email\":\"x3@example.test\",\"password\":\"Password123\",\"fullName\":\"X\",\"warehouseId\":\""+site+"\"}",422).path("code").asText()).isEqualTo("WAREHOUSE_DISABLED");
  }
  @Test void usersAndCustomers() throws Exception {
    var created=callAs(adminToken,post("/api/v1/admin/users"),"{\"email\":\"second@example.test\",\"password\":\"Password123\",\"fullName\":\"Second\"}",201);
    String second=created.path("user").path("id").asText();
    assertThat(callAs(adminToken,post("/api/v1/admin/users"),"{\"email\":\"second@example.test\",\"password\":\"Password123\",\"fullName\":\"Dup\"}",409).path("code").asText()).isEqualTo("EMAIL_EXISTS");
    assertThat(callAs(adminToken,post("/api/v1/admin/users"),"{\"email\":\"x@example.test\",\"password\":\"short\",\"fullName\":\"X\"}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    var list=callAs(adminToken,get("/api/v1/admin/users"),null,200);
    assertThat(list.path("total").asInt()).isEqualTo(2);
    assertThat(callAs(adminToken,patch("/api/v1/admin/users/"+adminId),"{\"active\":false}",403).path("code").asText()).isEqualTo("ADMIN_SELF_LOCKOUT");
    assertThat(callAs(adminToken,patch("/api/v1/admin/users/"+second),"{\"role\":\"CUSTOMER\"}",200).path("user").path("role").asText()).isEqualTo("CUSTOMER");
    assertThat(callAs(adminToken,patch("/api/v1/admin/users/"+second),"{\"role\":\"SUPER\"}",422).path("code").asText()).isEqualTo("ROLE_NOT_MANAGED");
    assertThat(callAs(adminToken,patch("/api/v1/admin/users/missing"),"{\"active\":false}",404).path("code").asText()).isEqualTo("USER_NOT_FOUND");
    var banned=callAs(adminToken,patch("/api/v1/admin/customers/"+customer),"{\"active\":false}",200);
    assertThat(banned.path("user").path("active").asBoolean()).isFalse();
    assertThat(callAs(adminToken,patch("/api/v1/admin/customers/"+adminId),"{\"active\":false}",404).path("code").asText()).isEqualTo("CUSTOMER_NOT_FOUND");
    assertThat(callAs(adminToken,patch("/api/v1/admin/customers/"+customer),"{}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
  }
  @Test void catalog() throws Exception {
    var cat=callAs(adminToken,post("/api/v1/admin/categories"),"{\"name\":\"TestCat One\"}",201);
    String catId=cat.path("category").path("id").asText();
    assertThat(callAs(adminToken,post("/api/v1/admin/categories"),"{\"name\":\"TestCat One\"}",409).path("code").asText()).isEqualTo("CATEGORY_NAME_EXISTS");
    assertThat(callAs(adminToken,get("/api/v1/admin/categories"),null,200).path("categories").size()).isPositive();
    var prod=callAs(adminToken,post("/api/v1/admin/products"),"{\"sku\":\"AW-1\",\"name\":\"Admin Widget\",\"pricePaise\":99900,\"stock\":7,\"categoryId\":\""+catId+"\"}",201);
    String prodId=prod.path("product").path("id").asText();
    assertThat(jdbc.queryForObject("select quantity from inventory_buckets where warehouse_id='wh-blr-01' and product_id=? and state='AVAILABLE'",Integer.class,prodId)).isEqualTo(7);
    assertThat(callAs(adminToken,post("/api/v1/admin/products"),"{\"sku\":\"AW-1\",\"name\":\"Dup\",\"pricePaise\":1,\"stock\":1}",409).path("code").asText()).isEqualTo("PRODUCT_SKU_EXISTS");
    assertThat(callAs(adminToken,post("/api/v1/admin/products"),"{\"sku\":\"AW-2\",\"name\":\"Bad\",\"pricePaise\":-5,\"stock\":1}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    var patched=callAs(adminToken,patch("/api/v1/admin/products/"+prodId),"{\"stock\":3,\"pricePaise\":88800}",200);
    assertThat(patched.path("product").path("stock").asInt()).isEqualTo(3);
    assertThat(jdbc.queryForObject("select quantity from inventory_buckets where warehouse_id='wh-blr-01' and product_id=? and state='AVAILABLE'",Integer.class,prodId)).isEqualTo(3);
    assertThat(callAs(adminToken,patch("/api/v1/admin/products/missing"),"{\"stock\":1}",404).path("code").asText()).isEqualTo("PRODUCT_NOT_FOUND");
    assertThat(callAs(adminToken,delete("/api/v1/admin/categories/"+catId),null,409).path("code").asText()).isEqualTo("CATEGORY_IN_USE");
    assertThat(callAs(adminToken,get("/api/v1/admin/products/"+prodId),null,200).path("product").path("sku").asText()).isEqualTo("AW-1");
    assertThat(callAs(adminToken,get("/api/v1/admin/products/missing"),null,404).path("code").asText()).isEqualTo("PRODUCT_NOT_FOUND");
    assertThat(callAs(adminToken,get("/api/v1/admin/categories/missing"),null,404).path("code").asText()).isEqualTo("CATEGORY_NOT_FOUND");
    jdbc.update("delete from products where id=?",prodId);
    jdbc.update("delete from inventory_buckets where product_id=?",prodId);
    callAs(adminToken,delete("/api/v1/admin/categories/"+catId),null,204);
    assertThat(callAs(adminToken,get("/api/v1/admin/categories/"+catId),null,404).path("code").asText()).isEqualTo("CATEGORY_NOT_FOUND");
  }
  @Test void supportNotificationsReports() throws Exception {
    var t=callAs(custToken,post("/api/v1/support/tickets"), "{\"subject\":\"Help me please\",\"body\":\"Broken\"}",201);
    String ticket=t.path("ticket").path("id").asText();
    var list=callAs(adminToken,get("/api/v1/admin/support/tickets"),null,200);
    assertThat(list.path("total").asInt()).isPositive();
    assertThat(callAs(adminToken,get("/api/v1/admin/support/tickets/"+ticket),null,200).path("ticket").path("id").asText()).isEqualTo(ticket);
    assertThat(callAs(adminToken,get("/api/v1/admin/support/tickets/missing"),null,404).path("code").asText()).isEqualTo("TICKET_NOT_FOUND");
    var assigned=callAs(adminToken,patch("/api/v1/admin/support/tickets/"+ticket),"{\"assignedTo\":\""+adminId+"\",\"priority\":\"HIGH\"}",200);
    assertThat(assigned.path("ticket").path("priority").asText()).isEqualTo("HIGH");
    assertThat(callAs(adminToken,patch("/api/v1/admin/support/tickets/"+ticket),"{\"assignedTo\":\""+customer+"\"}",422).path("code").asText()).isEqualTo("ASSIGNEE_INVALID");
    var reply=callAs(adminToken,post("/api/v1/admin/support/tickets/"+ticket+"/messages"),"{\"body\":\"We are on it\"}",201);
    assertThat(reply.path("message").path("id").asText()).isNotBlank();
    assertThat(jdbc.queryForObject("select count(*) from notifications where user_id=? and type='SUPPORT_UPDATE'",Integer.class,customer)).isPositive();
    var closed=callAs(adminToken,patch("/api/v1/admin/support/tickets/"+ticket),"{\"status\":\"CLOSED\"}",200);
    assertThat(closed.path("ticket").path("status").asText()).isEqualTo("CLOSED");
    var notifs=callAs(adminToken,get("/api/v1/admin/notifications"),null,200);
    assertThat(notifs.path("total").asInt()).isPositive();
    var templates=callAs(adminToken,get("/api/v1/admin/notifications/templates"),null,200);
    assertThat(templates.path("templates").size()).isPositive();
    var tpl=callAs(adminToken,put("/api/v1/admin/notifications/templates/CUSTOM_X"),"{\"title\":\"Hi\",\"body\":\"Hello\"}",200);
    assertThat(tpl.path("template").path("key").asText()).isEqualTo("CUSTOM_X");
    assertThat(callAs(adminToken,put("/api/v1/admin/notifications/templates/1bad"),"{\"title\":\"Hi\",\"body\":\"Hello\"}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    var csv=callAsRaw(adminToken,get("/api/v1/admin/reports/orders.csv"),200);
    assertThat(csv).contains("order_number");
    assertThat(callAsRaw(adminToken,get("/api/v1/admin/reports/returns.csv"),200)).contains("return_number");
    assertThat(callAsRaw(adminToken,get("/api/v1/admin/reports/refunds.csv"),200)).contains("return_number");
    assertThat(callAsRaw(adminToken,get("/api/v1/admin/reports/credit.csv"),200)).contains("user_email");
    assertThat(callAsRaw(adminToken,get("/api/v1/admin/reports/inventory.csv"),200)).contains("sku");
    assertThat(callAsRaw(adminToken,get("/api/v1/admin/reports/movements.csv"),200)).contains("reference_type");
    assertThat(callAs(custToken,get("/api/v1/admin/reports/orders.csv"),null,403).path("code").asText()).isEqualTo("ADMIN_REQUIRED");
  }
  private String callAsRaw(String tok,MockHttpServletRequestBuilder b,int expected) throws Exception { if(tok!=null)b.header("Authorization","Bearer "+tok); var result=http.perform(b).andExpect(status().is(expected)).andReturn(); return result.getResponse().getContentAsString(); }
  private JsonNode callAs(String tok,MockHttpServletRequestBuilder b,String body,int expected) throws Exception { if(body!=null){b.content(body);b.contentType(MediaType.APPLICATION_JSON);} if(tok!=null)b.header("Authorization","Bearer "+tok); var result=http.perform(b).andExpect(status().is(expected)).andReturn(); return json.readTree(result.getResponse().getContentAsString()); }
}
