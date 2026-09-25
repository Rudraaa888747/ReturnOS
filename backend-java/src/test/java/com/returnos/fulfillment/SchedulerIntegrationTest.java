package com.returnos.fulfillment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.returnos.ReturnOsApplication;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.containers.PostgreSQLContainer;

@SpringBootTest(classes = ReturnOsApplication.class)
@AutoConfigureMockMvc
class SchedulerIntegrationTest {
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
  @Autowired MockMvc http; @Autowired ObjectMapper json; @Autowired JdbcTemplate jdbc; @Autowired FulfillmentService fulfillment;
  String token, customer, address, orderId, retId;
  @BeforeEach void seed() throws Exception {
    jdbc.execute("TRUNCATE users CASCADE");
    jdbc.update("delete from inventory_buckets where product_id='p-sch'");
    jdbc.update("delete from products where id='p-sch'");
    var signup = callAs(null,post("/api/v1/auth/signup"), "{\"email\":\"sched@example.test\",\"password\":\"Password123\",\"fullName\":\"Sched\"}", 201);
    token=signup.path("token").asText(); customer=signup.path("user").path("id").asText();
    jdbc.update("insert into products(id,sku,name,price_paise,stock,active) values('p-sch','SCH-1','Sched Item',10000,10,true)");
    jdbc.update("insert into inventory_buckets(warehouse_id,product_id,state,quantity) values('wh-blr-01','p-sch','AVAILABLE',10)");
    var a=callAs(token,post("/api/v1/addresses"), "{\"fullName\":\"Sched\",\"line1\":\"1 Lane\",\"city\":\"Bengaluru\",\"state\":\"Karnataka\",\"postalCode\":\"560001\"}",201); address=a.path("address").path("id").asText();
    callAs(token,post("/api/v1/cart"), "{\"productId\":\"p-sch\",\"quantity\":1}",201);
    orderId=callAs(token,post("/api/v1/checkout"), "{\"addressId\":\""+address+"\",\"idempotencyKey\":\"sch-"+UUID.randomUUID()+"\"}",201).path("order").path("id").asText();
    String item=jdbc.queryForObject("select id from order_items where order_id=? limit 1",String.class,orderId);
    jdbc.update("update orders set delivered_at=now() where id=?",orderId);
    retId=callAs(token,post("/api/v1/returns"), "{\"orderId\":\""+orderId+"\",\"items\":[{\"orderItemId\":\""+item+"\",\"quantity\":1,\"reasonCode\":\"OTHER\"}],\"resolutionType\":\"REFUND\",\"pickupKind\":\"PICKUP\"}",201).path("ret").path("id").asText();
  }
  @Test void schedulerAdvancesCarrierLegAndStops() {
    var past=OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(10);
    jdbc.update("update orders set status='PLACED' where id=?",orderId);
    jdbc.update("update order_events set created_at=? where order_id=?",past,orderId);
    jdbc.update("update orders set created_at=? where id=?",past,orderId);
    jdbc.update("update returns set status='REQUESTED',updated_at=? where id=?",past,retId);
    fulfillment.tickFulfillment();
    assertThat(jdbc.queryForObject("select status from orders where id=?",String.class,orderId)).isEqualTo("CONFIRMED");
    assertThat(jdbc.queryForObject("select status from returns where id=?",String.class,retId)).isEqualTo("APPROVED");
    assertThat(jdbc.queryForObject("select approved_at from returns where id=?",Object.class,retId)).isNotNull();
    assertThat(jdbc.queryForObject("select status from pickups where return_id=?",String.class,retId)).isEqualTo("SCHEDULED");
    fulfillment.tickFulfillment();
    assertThat(jdbc.queryForObject("select status from orders where id=?",String.class,orderId)).isEqualTo("CONFIRMED");
    jdbc.update("update order_events set created_at=? where order_id=?",past,orderId);
    jdbc.update("update returns set updated_at=? where id=?",past,retId);
    fulfillment.tickFulfillment();
    assertThat(jdbc.queryForObject("select status from orders where id=?",String.class,orderId)).isEqualTo("PROCESSING");
    assertThat(jdbc.queryForObject("select status from returns where id=?",String.class,retId)).isEqualTo("PICKED_UP");
    jdbc.update("update returns set updated_at=? where id=?",past,retId);
    fulfillment.tickFulfillment();
    assertThat(jdbc.queryForObject("select status from returns where id=?",String.class,retId)).isEqualTo("IN_TRANSIT");
    assertThat(jdbc.queryForObject("select count(*) from warehouse_tasks where return_id=? and kind='RECEIVE_RETURN'",Integer.class,retId)).isEqualTo(1);
    jdbc.update("update returns set updated_at=? where id=?",past,retId);
    fulfillment.tickFulfillment();
    assertThat(jdbc.queryForObject("select status from returns where id=?",String.class,retId)).isEqualTo("IN_TRANSIT");
    assertThat(jdbc.queryForObject("select count(*) from receiving_records where return_id=?",Integer.class,retId)).isZero();
  }
  @Test void schedulerSkipsTerminalAndUnknown() {
    jdbc.update("update orders set status='DELIVERED',delivered_at=now(),created_at=? where id=?",OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(30),orderId);
    jdbc.update("update order_events set created_at=? where order_id=?",OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(30),orderId);
    jdbc.update("update returns set status='CANCELLED',updated_at=? where id=?",OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(30),retId);
    int events=jdbc.queryForObject("select count(*) from order_events where order_id=?",Integer.class,orderId);
    fulfillment.tickFulfillment();
    assertThat(jdbc.queryForObject("select status from orders where id=?",String.class,orderId)).isEqualTo("DELIVERED");
    assertThat(jdbc.queryForObject("select status from returns where id=?",String.class,retId)).isEqualTo("CANCELLED");
    assertThat(jdbc.queryForObject("select count(*) from order_events where order_id=?",Integer.class,orderId)).isEqualTo(events);
  }
  private JsonNode callAs(String tok,MockHttpServletRequestBuilder b,String body,int expected) throws Exception { if(body!=null){b.content(body);b.contentType(MediaType.APPLICATION_JSON);} if(tok!=null)b.header("Authorization","Bearer "+tok); var result=http.perform(b).andExpect(status().is(expected)).andReturn(); return json.readTree(result.getResponse().getContentAsString()); }
}
