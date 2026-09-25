package com.returnos.returns;

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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;

@SpringBootTest(classes = ReturnOsApplication.class)
@AutoConfigureMockMvc
class ReturnsIntegrationTest {
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
  @Autowired MockMvc http; @Autowired ObjectMapper json; @Autowired JdbcTemplate jdbc;
  String token, customer, address, orderId, orderItemId;
  @BeforeEach void seed() throws Exception {
    jdbc.execute("TRUNCATE users CASCADE");
    jdbc.update("delete from inventory_buckets where product_id='p-ret'");
    jdbc.update("delete from products where id='p-ret'");
    var signup = call(post("/api/v1/auth/signup"), "{\"email\":\"returner@example.test\",\"password\":\"Password123\",\"fullName\":\"Returner\"}", 201);
    token=signup.path("token").asText(); customer=signup.path("user").path("id").asText();
    jdbc.update("insert into products(id,sku,name,price_paise,stock,active) values('p-ret','RET-1','Returnable',100000,10,true)");
    jdbc.update("insert into inventory_buckets(warehouse_id,product_id,state,quantity) values('wh-blr-01','p-ret','AVAILABLE',10)");
    var a=call(post("/api/v1/addresses"), "{\"fullName\":\"Returner\",\"line1\":\"1 Lane\",\"city\":\"Bengaluru\",\"state\":\"Karnataka\",\"postalCode\":\"560001\"}",201); address=a.path("address").path("id").asText();
    call(post("/api/v1/cart"), "{\"productId\":\"p-ret\",\"quantity\":2}",201);
    orderId=call(post("/api/v1/checkout"), "{\"addressId\":\""+address+"\",\"idempotencyKey\":\"ret-order-"+UUID.randomUUID()+"\"}",201).path("order").path("id").asText();
    orderItemId=jdbc.queryForObject("select id from order_items where order_id=? limit 1",String.class,orderId);
  }
  String returnBody(String itemId,int qty,String reason,String resolution){
    return "{\"orderId\":\""+orderId+"\",\"items\":[{\"orderItemId\":\""+itemId+"\",\"quantity\":"+qty+",\"reasonCode\":\""+reason+"\"}],\"resolutionType\":\""+resolution+"\",\"pickupKind\":\"PICKUP\"}";
  }
  @Test void returnLifecycleMatchesReference() throws Exception {
    assertThat(call(post("/api/v1/returns"), returnBody(orderItemId,1,"CHANGED_MIND","REFUND"),422).path("code").asText()).isEqualTo("RETURN_WINDOW_EXPIRED");
    jdbc.update("update orders set delivered_at=now() where id=?",orderId);
    assertThat(call(post("/api/v1/returns"), returnBody("missing",1,"CHANGED_MIND","REFUND"),422).path("code").asText()).isEqualTo("INVALID_ORDER_ITEM");
    assertThat(call(post("/api/v1/returns"), returnBody(orderItemId,1,"NOPE","REFUND"),422).path("code").asText()).isEqualTo("INVALID_REASON");
    assertThat(call(post("/api/v1/returns"), returnBody(orderItemId,5,"CHANGED_MIND","REFUND"),422).path("code").asText()).isEqualTo("QUANTITY_EXCEEDS_REMAINING");
    assertThat(call(post("/api/v1/returns"), returnBody(orderItemId,1,"DEFECTIVE","STORE_CREDIT"),422).path("code").asText()).isEqualTo("RESOLUTION_NOT_ALLOWED");
    assertThat(call(post("/api/v1/returns"), "{\"orderId\":\"missing\",\"items\":[],\"resolutionType\":\"REFUND\",\"pickupKind\":\"PICKUP\"}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    var created=call(post("/api/v1/returns"), returnBody(orderItemId,1,"CHANGED_MIND","REFUND"),201);
    String retId=created.path("ret").path("id").asText();
    assertThat(created.path("ret").path("return_number").asText()).startsWith("RET-");
    assertThat(created.path("ret").path("status").asText()).isEqualTo("REQUESTED");
    assertThat(created.path("items").get(0).path("unitPrice").asDouble()).isEqualTo(1000.0);
    assertThat(created.path("refund").path("amount_paise").asInt()).isEqualTo(100000);
    assertThat(created.has("order")).isTrue();
    assertThat(jdbc.queryForObject("select count(*) from notifications where user_id=? and type='RETURN_CREATED'",Integer.class,customer)).isEqualTo(1);
    var list=call(get("/api/v1/returns"),null,200);
    assertThat(list.path("returns").get(0).path("orderNumber").asText()).isNotBlank();
    assertThat(list.path("returns").get(0).path("itemQuantity").asInt()).isEqualTo(1);
    assertThat(list.path("returns").get(0).path("productName").asText()).isEqualTo("Returnable");
    var timeline=call(get("/api/v1/returns/"+retId+"/timeline"),null,200);
    assertThat(timeline.path("events").get(0).path("status").asText()).isEqualTo("REQUESTED");
    assertThat(timeline.path("events").get(0).has("created_at")).isTrue();
    String number=created.path("ret").path("return_number").asText();
    var track=call(get("/api/v1/tracking/"+number),null,200);
    assertThat(track.path("status").asText()).isEqualTo("REQUESTED");
    assertThat(track.path("events").size()).isPositive();
    assertThat(call(get("/api/v1/tracking/RET-2000-0000"),null,404).path("code").asText()).isEqualTo("TRACKING_NOT_FOUND");
    var cancelled=call(post("/api/v1/returns/"+retId+"/cancel"), "{\"reason\":\"no longer needed\"}",200);
    assertThat(cancelled.path("ret").path("status").asText()).isEqualTo("CANCELLED");
    assertThat(jdbc.queryForObject("select count(*) from notifications where user_id=? and type='RETURN_CANCELLED'",Integer.class,customer)).isEqualTo(1);
    assertThat(call(post("/api/v1/returns/"+retId+"/cancel"), "{\"reason\":\"again\"}",409).path("code").asText()).isEqualTo("CANCEL_NOT_ALLOWED");
    assertThat(call(post("/api/v1/returns/"+retId+"/cancel"), "{\"reason\":\"x\"}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    var again=call(post("/api/v1/returns"), returnBody(orderItemId,2,"CHANGED_MIND","REFUND"),201);
    assertThat(again.path("ret").path("status").asText()).isEqualTo("REQUESTED");
  }
  @Test void returnOwnership() throws Exception {
    jdbc.update("update orders set delivered_at=now() where id=?",orderId);
    String retId=call(post("/api/v1/returns"), returnBody(orderItemId,1,"CHANGED_MIND","REFUND"),201).path("ret").path("id").asText();
    String number=jdbc.queryForObject("select return_number from returns where id=?",String.class,retId);
    var other=call(post("/api/v1/auth/signup"), "{\"email\":\"stranger@example.test\",\"password\":\"Password123\",\"fullName\":\"Stranger\"}",201);
    String otherToken=other.path("token").asText();
    assertThat(callAs(otherToken,get("/api/v1/returns/"+retId),null,404).path("code").asText()).isEqualTo("RETURN_NOT_FOUND");
    assertThat(callAs(otherToken,get("/api/v1/tracking/"+number),null,404).path("code").asText()).isEqualTo("TRACKING_NOT_FOUND");
    assertThat(callAs(otherToken,get("/api/v1/returns"),null,200).path("returns").size()).isZero();
  }
  private JsonNode call(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder b,String body,int expected) throws Exception { return callAs(token,b,body,expected); }
  private JsonNode callAs(String tok,org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder b,String body,int expected) throws Exception { if(body!=null)b.content(body); var result=http.perform(b.header("Authorization","Bearer "+tok).contentType(MediaType.APPLICATION_JSON)).andExpect(status().is(expected)).andReturn(); return json.readTree(result.getResponse().getContentAsString()); }
}
