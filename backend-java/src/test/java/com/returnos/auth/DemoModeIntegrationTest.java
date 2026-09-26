package com.returnos.auth;

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

/** Demo deployments are read-only for the public demo accounts. */
@SpringBootTest(classes = ReturnOsApplication.class)
@AutoConfigureMockMvc
class DemoModeIntegrationTest {
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
    r.add("returnos.demo-mode", () -> "true");
  }
  static String envOr(String name, String fallback) {
    String v = System.getenv(name);
    return (v == null || v.isBlank()) ? fallback : v;
  }
  @Autowired MockMvc http; @Autowired ObjectMapper json; @Autowired JdbcTemplate jdbc;
  @Autowired org.springframework.security.crypto.password.PasswordEncoder passwords;
  @BeforeEach void ensureDemoActors() {
    jdbc.update("insert into warehouses(id,code,name,city) values('wh-blr-01','BLR-01','Bengaluru Returns Hub','Bengaluru') on conflict(id) do nothing");
    jdbc.update("insert into users(id,email,password_hash,full_name,role,warehouse_id,active) values('u-demo-cx','customer@returnos.test',?,'Demo Customer','CUSTOMER',NULL,true) on conflict(email) do nothing", passwords.encode("Customer123"));
    jdbc.update("insert into users(id,email,password_hash,full_name,role,warehouse_id,active) values('u-demo-wh','warehouse@returnos.test',?,'Warehouse Operator','WAREHOUSE','wh-blr-01',true) on conflict(email) do nothing", passwords.encode("Warehouse123"));
    jdbc.update("insert into users(id,email,password_hash,full_name,role,warehouse_id,active) values('u-demo-ad','admin@returnos.test',?,'ReturnOS Admin','ADMIN',NULL,true) on conflict(email) do nothing", passwords.encode("Admin123"));
  }
  @Test void demoCustomerReadsButCannotMutate() throws Exception {
    var login = callAs(null, post("/api/v1/auth/login"), "{\"email\":\"customer@returnos.test\",\"password\":\"Customer123\"}", 200);
    String token = login.path("token").asText();
    assertThat(token).isNotBlank();
    assertThat(callAs(token, get("/api/v1/products"), null, 200).path("products").isArray()).isTrue();
    assertThat(callAs(token, get("/api/v1/credit"), null, 200).path("balancePaise").isInt()).isTrue();
    var blocked = callAs(token, post("/api/v1/cart"), "{\"productId\":\"p-tee\",\"quantity\":1}", 403);
    assertThat(blocked.path("code").asText()).isEqualTo("DEMO_MODE");
    assertThat(jdbc.queryForObject("select count(*) from cart_items", Integer.class)).isZero();
  }
  @Test void demoWarehouseAndAdminCannotMutate() throws Exception {
    var wh = callAs(null, post("/api/v1/auth/login"), "{\"email\":\"warehouse@returnos.test\",\"password\":\"Warehouse123\"}", 200);
    assertThat(callAs(wh.path("token").asText(), get("/api/v1/warehouse/summary"), null, 200).has("awaitingArrival")).isTrue();
    var blocked = callAs(wh.path("token").asText(), post("/api/v1/warehouse/returns/r-2026-0841/approve"), "{}", 403);
    assertThat(blocked.path("code").asText()).isEqualTo("DEMO_MODE");
    var ad = callAs(null, post("/api/v1/auth/login"), "{\"email\":\"admin@returnos.test\",\"password\":\"Admin123\"}", 200);
    assertThat(callAs(ad.path("token").asText(), get("/api/v1/admin/summary"), null, 200).has("warehouse")).isTrue();
    assertThat(callAs(ad.path("token").asText(), post("/api/v1/auth/signup"), "{\"email\":\"x@example.test\",\"password\":\"Password123\",\"fullName\":\"X Y\"}", 403).path("code").asText()).isEqualTo("DEMO_MODE");
  }
  private JsonNode callAs(String tok, MockHttpServletRequestBuilder b, String body, int expected) throws Exception {
    if (body != null) { b.content(body); b.contentType(MediaType.APPLICATION_JSON); }
    if (tok != null) b.header("Authorization", "Bearer " + tok);
    var result = http.perform(b).andExpect(status().is(expected)).andReturn();
    return json.readTree(result.getResponse().getContentAsString());
  }
}
