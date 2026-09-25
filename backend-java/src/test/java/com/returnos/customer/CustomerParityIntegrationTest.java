package com.returnos.customer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.returnos.ReturnOsApplication;
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
class CustomerParityIntegrationTest {
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
  String token, customer;
  @BeforeEach void seed() throws Exception {
    jdbc.execute("TRUNCATE users CASCADE");
    jdbc.update("delete from inventory_buckets where product_id='p-cx'");
    jdbc.update("delete from products where id='p-cx'");
    var signup = callAs(null,post("/api/v1/auth/signup"), "{\"email\":\"cx@example.test\",\"password\":\"Password123\",\"fullName\":\"Cx\"}", 201);
    token=signup.path("token").asText(); customer=signup.path("user").path("id").asText();
  }
  @Test void addressesRawShapeAndDefaults() throws Exception {
    assertThat(callAs(token,get("/api/v1/addresses"),null,200).path("addresses").size()).isZero();
    var a1=callAs(token,post("/api/v1/addresses"), "{\"fullName\":\"Cx\",\"line1\":\"1 Lane\",\"city\":\"Bengaluru\",\"state\":\"Karnataka\",\"postalCode\":\"560001\"}",201);
    assertThat(a1.path("address").path("is_default").asInt()).isEqualTo(1);
    assertThat(a1.path("address").path("country").asText()).isEqualTo("IN");
    assertThat(a1.path("address").has("full_name")).isTrue();
    String id1=a1.path("address").path("id").asText();
    var a2=callAs(token,post("/api/v1/addresses"), "{\"fullName\":\"Cx\",\"line1\":\"2 Lane\",\"city\":\"Mumbai\",\"state\":\"MH\",\"postalCode\":\"400001\"}",201);
    String id2=a2.path("address").path("id").asText();
    assertThat(a2.path("address").path("is_default").asInt()).isEqualTo(0);
    var list=callAs(token,get("/api/v1/addresses"),null,200);
    assertThat(list.path("addresses").get(0).path("id").asText()).isEqualTo(id1);
    callAs(token,patch("/api/v1/addresses/"+id2),"{\"isDefault\":true}",200);
    assertThat(callAs(token,get("/api/v1/addresses/"+id2),null,200).path("address").path("is_default").asInt()).isEqualTo(1);
    callAs(token,patch("/api/v1/addresses/"+id2),"{\"isDefault\":false}",200);
    assertThat(callAs(token,get("/api/v1/addresses/"+id2),null,200).path("address").path("is_default").asInt()).isEqualTo(1);
    callAs(token,delete("/api/v1/addresses/"+id2),null,200);
    assertThat(callAs(token,get("/api/v1/addresses/"+id1),null,200).path("address").path("is_default").asInt()).isEqualTo(1);
    assertThat(callAs(token,get("/api/v1/addresses/missing"),null,404).path("code").asText()).isEqualTo("ADDRESS_NOT_FOUND");
    assertThat(callAs(token,delete("/api/v1/addresses/missing"),null,404).path("code").asText()).isEqualTo("ADDRESS_NOT_FOUND");
    assertThat(callAs(token,post("/api/v1/addresses"), "{\"fullName\":\"X\"}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    var other=callAs(null,post("/api/v1/auth/signup"), "{\"email\":\"intruder@example.test\",\"password\":\"Password123\",\"fullName\":\"Intruder\"}",201);
    assertThat(callAs(other.path("token").asText(),get("/api/v1/addresses/"+id1),null,404).path("code").asText()).isEqualTo("ADDRESS_NOT_FOUND");
  }
  @Test void profilePrefsAndPassword() throws Exception {
    var p=callAs(token,get("/api/v1/profile"),null,200);
    assertThat(p.path("user").path("fullName").asText()).isEqualTo("Cx");
    assertThat(p.path("profile").path("commPrefs").isObject()).isTrue();
    var patched=callAs(token,patch("/api/v1/profile"),"{\"fullName\":\"Cx New\",\"phone\":\"9876543210\"}",200);
    assertThat(patched.path("user").path("fullName").asText()).isEqualTo("Cx New");
    assertThat(callAs(token,patch("/api/v1/profile"),"{\"fullName\":\"X\"}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    var s=callAs(token,patch("/api/v1/profile/settings"),"{\"commPrefs\":{\"offers\":true},\"notifPrefs\":{\"sms\":false}}",200);
    assertThat(s.path("profile").path("commPrefs").path("offers").asBoolean()).isTrue();
    assertThat(callAs(token,patch("/api/v1/profile/settings"),"{\"commPrefs\":{\"x\":\"y\"}}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    assertThat(callAs(token,post("/api/v1/profile/change-password"),"{\"currentPassword\":\"Password123\",\"newPassword\":\"Password123\"}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    assertThat(callAs(token,post("/api/v1/profile/change-password"),"{\"currentPassword\":\"wrong\",\"newPassword\":\"Newpass123\"}",401).path("code").asText()).isEqualTo("INVALID_CREDENTIALS");
    assertThat(callAs(token,post("/api/v1/profile/change-password"),"{\"currentPassword\":\"Password123\",\"newPassword\":\"Newpass123\"}",200).path("message").asText()).isEqualTo("Password changed successfully");
    assertThat(callAs(null,post("/api/v1/auth/login"),"{\"email\":\"cx@example.test\",\"password\":\"Newpass123\"}",200).path("token").asText()).isNotBlank();
    assertThat(callAs(token,get("/api/v1/auth/me"),null,200).path("user").path("email").asText()).isEqualTo("cx@example.test");
  }
  @Test void productsNotificationsMetaCredit() throws Exception {
    jdbc.update("insert into products(id,sku,name,price_paise,stock,active) values('p-cx','CX-1','Cx Item',42000,5,true)");
    var list=callAs(token,get("/api/v1/products"),null,200);
    assertThat(list.path("products").size()).isPositive();
    assertThat(list.path("products").get(0).has("pricePaise")).isTrue();
    var one=callAs(token,get("/api/v1/products/p-cx"),null,200);
    assertThat(one.path("product").path("pricePaise").asInt()).isEqualTo(42000);
    assertThat(one.path("product").path("active").asBoolean()).isTrue();
    assertThat(callAs(token,get("/api/v1/products/missing"),null,404).path("code").asText()).isEqualTo("PRODUCT_NOT_FOUND");
    jdbc.update("insert into notifications(id,user_id,type,title,body) values(?,?, 'ORDER_PLACED','T','B')","n-test-1",customer);
    var notifs=callAs(token,get("/api/v1/notifications"),null,200);
    assertThat(notifs.path("notifications").get(0).path("is_read").asInt()).isEqualTo(0);
    assertThat(callAs(token,get("/api/v1/notifications?unreadOnly=true"),null,200).path("notifications").size()).isEqualTo(1);
    assertThat(callAs(token,post("/api/v1/notifications/n-test-1/read"),null,200).path("message").asText()).isEqualTo("Notification marked as read");
    assertThat(callAs(token,get("/api/v1/notifications?unreadOnly=true"),null,200).path("notifications").size()).isZero();
    assertThat(callAs(token,post("/api/v1/notifications/missing/read"),null,404).path("code").asText()).isEqualTo("NOTIFICATION_NOT_FOUND");
    var all=callAs(token,post("/api/v1/notifications/read-all"),null,200);
    assertThat(all.path("updated").asInt()).isEqualTo(0);
    var reasons=callAs(token,get("/api/v1/meta/reasons"),null,200);
    assertThat(reasons.path("reasons").size()).isPositive();
    assertThat(reasons.path("reasons").get(0).has("sort_order")).isTrue();
    var constants=callAs(null,get("/api/v1/meta/constants"),null,200);
    assertThat(constants.path("returnWindowDays").asInt()).isEqualTo(30);
    assertThat(constants.path("returnStatuses").toString()).contains("CANCELLED");
    var credit=callAs(token,get("/api/v1/credit"),null,200);
    assertThat(credit.path("balancePaise").asInt()).isZero();
    assertThat(credit.path("history").isArray()).isTrue();
  }
  private JsonNode callAs(String tok,MockHttpServletRequestBuilder b,String body,int expected) throws Exception { if(body!=null){b.content(body);b.contentType(MediaType.APPLICATION_JSON);} if(tok!=null)b.header("Authorization","Bearer "+tok); var result=http.perform(b).andExpect(status().is(expected)).andReturn(); return json.readTree(result.getResponse().getContentAsString()); }
}
