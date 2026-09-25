package com.returnos.orders;

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
class CheckoutIntegrationTest {
  // Testcontainers when Docker handshake works; otherwise externally-provided
  // PostgreSQL via TEST_DB_URL/_USERNAME/_PASSWORD (see handoff section 7).
  // Container is started programmatically so env mode never touches Docker.
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
  String token, customer, address;
  @BeforeEach void seed() throws Exception {
    jdbc.execute("TRUNCATE users CASCADE");
    jdbc.update("delete from inventory_buckets where product_id='p-test'");
    jdbc.update("delete from products where id='p-test'");
    var signup = call(post("/api/v1/auth/signup"), "{\"email\":\"buyer@example.test\",\"password\":\"Password123\",\"fullName\":\"Buyer Test\"}", 201);
    token=signup.path("token").asText(); customer=signup.path("user").path("id").asText();
    jdbc.update("insert into products(id,sku,name,price_paise,stock,active) values('p-test','TEST-1','Test product',100000,10,true)");
    jdbc.update("insert into inventory_buckets(warehouse_id,product_id,state,quantity) values('wh-blr-01','p-test','AVAILABLE',10)");
    var a=call(post("/api/v1/addresses"), "{\"fullName\":\"Buyer\",\"line1\":\"1 Test Lane\",\"city\":\"Bengaluru\",\"state\":\"Karnataka\",\"postalCode\":\"560001\"}",201); address=a.path("address").path("id").asText();
  }
  @Test void quoteAndCheckoutDeductStockDebitCreditAndReplay() throws Exception {
    call(post("/api/v1/cart"), "{\"productId\":\"p-test\",\"quantity\":2}",201);
    jdbc.update("insert into store_credit_ledger(id,user_id,type,amount_paise,reference_type,reference_id) values(?,?, 'CREDIT',50000,'TEST',?)",UUID.randomUUID().toString(),customer,UUID.randomUUID().toString());
    var quote=call(post("/api/v1/checkout/quote"), "{\"addressId\":\""+address+"\",\"useStoreCredit\":true}",200);
    assertThat(quote.path("subtotalPaise").asInt()).isEqualTo(200000); assertThat(quote.path("shippingPaise").asInt()).isEqualTo(9900); assertThat(quote.path("creditToUsePaise").asInt()).isEqualTo(50000);
    String body="{\"addressId\":\""+address+"\",\"useStoreCredit\":true,\"idempotencyKey\":\"checkout-key\"}"; var first=call(post("/api/v1/checkout"),body,201); String order=first.path("order").path("id").asText();
    assertThat(jdbc.queryForObject("select stock from products where id='p-test'",Integer.class)).isEqualTo(8); assertThat(jdbc.queryForObject("select quantity from inventory_buckets where warehouse_id='wh-blr-01' and product_id='p-test' and state='AVAILABLE'",Integer.class)).isEqualTo(8); assertThat(jdbc.queryForObject("select coalesce(sum(amount_paise),0) from store_credit_ledger where user_id=?",Integer.class,customer)).isZero();
    var replay=call(post("/api/v1/checkout"),body,200); assertThat(replay.path("order").path("id").asText()).isEqualTo(order); assertThat(jdbc.queryForObject("select count(*) from orders where customer_id=?",Integer.class,customer)).isEqualTo(1);
  }
  @Test void orderEndpointsEnforceOwnershipAndRollbackInsufficientStock() throws Exception {
    call(post("/api/v1/cart"), "{\"productId\":\"p-test\",\"quantity\":1}",201); jdbc.update("update products set stock=0 where id='p-test'");
    call(post("/api/v1/checkout"),"{\"addressId\":\""+address+"\",\"idempotencyKey\":\"stock-key\"}",409); assertThat(jdbc.queryForObject("select count(*) from orders",Integer.class)).isZero(); assertThat(jdbc.queryForObject("select quantity from cart_items where user_id=?",Integer.class,customer)).isEqualTo(1);
  }
  @Test void cartLifecycleMatchesReference() throws Exception {
    var empty=call(get("/api/v1/cart"),null,200);
    assertThat(empty.path("items").size()).isZero(); assertThat(empty.path("subtotalPaise").asInt()).isZero(); assertThat(empty.path("totalQuantity").asInt()).isZero();
    var added=call(post("/api/v1/cart"), "{\"productId\":\"p-test\",\"quantity\":2}",201);
    assertThat(added.path("items").get(0).path("lineTotalPaise").asInt()).isEqualTo(200000);
    assertThat(added.path("subtotalPaise").asInt()).isEqualTo(200000); assertThat(added.path("totalQuantity").asInt()).isEqualTo(2);
    assertThat(call(post("/api/v1/cart"), "{\"productId\":\"p-test\",\"quantity\":9}",409).path("code").asText()).isEqualTo("INSUFFICIENT_STOCK");
    var set=call(patch("/api/v1/cart/p-test"), "{\"quantity\":5}",200);
    assertThat(set.path("items").get(0).path("quantity").asInt()).isEqualTo(5); assertThat(set.path("subtotalPaise").asInt()).isEqualTo(500000);
    assertThat(call(patch("/api/v1/cart/p-test"), "{\"quantity\":99}",409).path("code").asText()).isEqualTo("INSUFFICIENT_STOCK");
    assertThat(call(patch("/api/v1/cart/p-test"), "{\"quantity\":0}",200).path("items").size()).isZero();
    var upsert=call(patch("/api/v1/cart/p-test"), "{\"quantity\":3}",200);
    assertThat(upsert.path("items").get(0).path("quantity").asInt()).isEqualTo(3);
    assertThat(call(delete("/api/v1/cart/p-test"),null,200).path("items").size()).isZero();
    assertThat(call(delete("/api/v1/cart/p-test"),null,200).path("items").size()).isZero();
    assertThat(call(post("/api/v1/cart"), "{\"productId\":\"p-test\",\"quantity\":0}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    assertThat(call(post("/api/v1/cart"), "{\"productId\":\"missing\",\"quantity\":1}",404).path("code").asText()).isEqualTo("PRODUCT_NOT_FOUND");
    assertThat(call(patch("/api/v1/cart/missing"), "{\"quantity\":1}",404).path("code").asText()).isEqualTo("PRODUCT_NOT_FOUND");
  }
  @Test void ordersTrackingOwnershipAndValidation() throws Exception {
    call(post("/api/v1/cart"), "{\"productId\":\"p-test\",\"quantity\":1}",201);
    String order=call(post("/api/v1/checkout"), "{\"addressId\":\""+address+"\",\"idempotencyKey\":\"orders-key\"}",201).path("order").path("id").asText();
    assertThat(jdbc.queryForObject("select count(*) from notifications where user_id=? and type='ORDER_PLACED'",Integer.class,customer)).isEqualTo(1);
    var list=call(get("/api/v1/orders"),null,200);
    assertThat(list.path("orders").size()).isEqualTo(1); assertThat(list.path("orders").get(0).path("id").asText()).isEqualTo(order);
    var detail=call(get("/api/v1/orders/"+order),null,200);
    assertThat(detail.path("eligible").asBoolean()).isFalse();
    assertThat(detail.path("ineligibleReason").asText()).isEqualTo("Available once the order is delivered");
    assertThat(detail.path("items").get(0).path("remaining_quantity").asInt()).isEqualTo(1);
    assertThat(detail.path("items").get(0).path("eligible").asBoolean()).isFalse();
    assertThat(detail.path("resolutionsByReason").size()).isPositive();
    assertThat(call(get("/api/v1/orders/missing"),null,404).path("code").asText()).isEqualTo("ORDER_NOT_FOUND");
    var tracking=call(get("/api/v1/orders/"+order+"/tracking"),null,200);
    assertThat(tracking.path("status").asText()).isEqualTo("PLACED");
    assertThat(tracking.path("trackingNumber").asText()).startsWith("TRK");
    assertThat(tracking.path("orderNumber").asText()).startsWith("ORD-");
    assertThat(tracking.path("events").get(0).path("status").asText()).isEqualTo("PLACED");
    var other=call(post("/api/v1/auth/signup"), "{\"email\":\"other@example.test\",\"password\":\"Password123\",\"fullName\":\"Other\"}",201);
    String otherToken=other.path("token").asText();
    assertThat(callAs(otherToken,get("/api/v1/orders/"+order),null,404).path("code").asText()).isEqualTo("ORDER_NOT_FOUND");
    assertThat(callAs(otherToken,get("/api/v1/orders/"+order+"/tracking"),null,404).path("code").asText()).isEqualTo("ORDER_NOT_FOUND");
    assertThat(callAs(otherToken,get("/api/v1/orders"),null,200).path("orders").size()).isZero();
    assertThat(callAs(otherToken,post("/api/v1/checkout"), "{\"addressId\":\""+address+"\",\"idempotencyKey\":\"orders-key\"}",409).path("code").asText()).isEqualTo("IDEMPOTENCY_KEY_USED");
    assertThat(anon(get("/api/v1/cart"),401).path("code").asText()).isEqualTo("UNAUTHORIZED");
  }
  @Test void quoteAndCheckoutValidation() throws Exception {
    assertThat(call(post("/api/v1/checkout/quote"), "{\"addressId\":\"missing\"}",404).path("code").asText()).isEqualTo("ADDRESS_NOT_FOUND");
    assertThat(call(post("/api/v1/checkout/quote"), "{\"addressId\":\""+address+"\"}",400).path("code").asText()).isEqualTo("EMPTY_CART");
    assertThat(call(post("/api/v1/checkout"), "{\"addressId\":\""+address+"\"}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    call(post("/api/v1/cart"), "{\"productId\":\"p-test\",\"quantity\":1}",201);
    assertThat(call(post("/api/v1/checkout"), "{\"addressId\":\"missing\",\"idempotencyKey\":\"bad-addr\"}",404).path("code").asText()).isEqualTo("ADDRESS_NOT_FOUND");
  }
  private JsonNode call(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder b,String body,int expected) throws Exception { return callAs(token,b,body,expected); }
  private JsonNode callAs(String tok,org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder b,String body,int expected) throws Exception { if(body!=null)b.content(body); var result=http.perform(b.header("Authorization","Bearer "+tok).contentType(MediaType.APPLICATION_JSON)).andExpect(status().is(expected)).andReturn(); return json.readTree(result.getResponse().getContentAsString()); }
  private JsonNode anon(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder b,int expected) throws Exception { var result=http.perform(b.contentType(MediaType.APPLICATION_JSON)).andExpect(status().is(expected)).andReturn(); return json.readTree(result.getResponse().getContentAsString()); }
}
