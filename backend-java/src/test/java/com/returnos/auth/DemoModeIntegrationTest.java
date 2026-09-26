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
  @Test void demoCustomerCanDriveTheShoppingWorkflow() throws Exception {
    String token = tokenFor("customer@returnos.test", "Customer123");
    assertThat(callAs(token, get("/api/v1/products"), null, 200).path("products").isArray()).isTrue();
    assertThat(callAs(token, get("/api/v1/credit"), null, 200).path("balancePaise").isInt()).isTrue();

    // The cart is the start of the flow the demo exists to show.
    callAs(token, post("/api/v1/cart"), "{\"productId\":\"p-tee\",\"quantity\":1}", 201);
    assertThat(jdbc.queryForObject("select count(*) from cart_items", Integer.class)).isPositive();
    callAs(token, delete("/api/v1/cart/p-tee"), null, 200);
  }

  @Test void demoCustomerCannotTouchTheSharedAccountOrUpload() throws Exception {
    String token = tokenFor("customer@returnos.test", "Customer123");

    // A password change would lock every other visitor out.
    assertThat(
      callAs(token, post("/api/v1/profile/change-password"),
        "{\"currentPassword\":\"Customer123\",\"newPassword\":\"Hijacked123\"}", 403).path("code").asText())
      .isEqualTo("DEMO_MODE");
    assertThat(passwords.matches("Customer123",
      jdbc.queryForObject("select password_hash from users where email='customer@returnos.test'", String.class)))
      .as("the shared demo password must be unchanged").isTrue();

    // Uploads would write real objects into the storage bucket.
    assertThat(callAs(token, post("/api/v1/uploads/return/r-2026-0841"), null, 403).path("code").asText())
      .isEqualTo("DEMO_MODE");

    // Signup would fill the shared user table.
    assertThat(callAs(token, post("/api/v1/auth/signup"),
      "{\"email\":\"x@example.test\",\"password\":\"Password123\",\"fullName\":\"X Y\"}", 403)
      .path("code").asText()).isEqualTo("DEMO_MODE");
  }

  @Test void demoWarehouseFloorStaysDemonstrable() throws Exception {
    String token = tokenFor("warehouse@returnos.test", "Warehouse123");
    assertThat(callAs(token, get("/api/v1/warehouse/summary"), null, 200).has("awaitingArrival")).isTrue();

    // The floor workflow is the point of the warehouse demo, so it must not be
    // rejected by demo mode. A non-DEMO_MODE outcome is what matters here: the
    // request reaches the controller and is judged on business rules.
    var result = http.perform(post("/api/v1/warehouse/returns/r-2026-0841/approve")
      .header("Authorization", "Bearer " + token).contentType(MediaType.APPLICATION_JSON).content("{}")).andReturn();
    assertThat(result.getResponse().getStatus()).as("approve must not be demo-blocked").isNotEqualTo(403);
    for (String path : new String[] {
        "/api/v1/warehouse/returns/r-2026-0841/receive",
        "/api/v1/warehouse/returns/r-2026-0841/inspection/start",
        "/api/v1/warehouse/returns/r-2026-0841/inspection/complete",
        "/api/v1/warehouse/returns/r-2026-0841/disposition" }) {
      var res = http.perform(post(path).header("Authorization", "Bearer " + token)
        .contentType(MediaType.APPLICATION_JSON).content("{}")).andReturn();
      assertThat(res.getResponse().getContentAsString()).as(path + " must not be demo-blocked").doesNotContain("DEMO_MODE");
    }
  }

  @Test void demoAdminReadsButCannotChangeTheSystem() throws Exception {
    String token = tokenFor("admin@returnos.test", "Admin123");
    assertThat(callAs(token, get("/api/v1/admin/summary"), null, 200).has("warehouse")).isTrue();

    // Every admin write is fail-closed except the support desk.
    record Case(MockHttpServletRequestBuilder request, String body) {}
    var sensitive = java.util.List.of(
      new Case(post("/api/v1/admin/credit/adjustments"), "{\"userId\":\"u-demo-cx\",\"amountPaise\":100000,\"reason\":\"demo probe reason\"}"),
      new Case(post("/api/v1/admin/users"), "{\"email\":\"n@example.test\",\"password\":\"Password123\",\"fullName\":\"N N\"}"),
      new Case(patch("/api/v1/admin/users/u-demo-ad"), "{\"active\":false}"),
      new Case(patch("/api/v1/admin/customers/u-demo-cx"), "{\"active\":false}"),
      new Case(patch("/api/v1/admin/settings/RETURN_WINDOW_DAYS"), "{\"value\":1}"),
      new Case(post("/api/v1/admin/categories"), "{\"name\":\"Demo probe\"}"),
      new Case(post("/api/v1/admin/warehouses"), "{\"code\":\"DMO-1\",\"name\":\"Probe\",\"city\":\"Nowhere\"}"));
    for (var probe : sensitive) {
      assertThat(callAs(token, probe.request(), probe.body(), 403).path("code").asText()).isEqualTo("DEMO_MODE");
    }

    // Nothing landed: no credit invented, no admin disabled.
    assertThat(jdbc.queryForObject(
      "select count(*) from store_credit_ledger where reference_type='ADMIN_ADJUSTMENT'", Integer.class)).isZero();
    assertThat(jdbc.queryForObject("select active from users where email='admin@returnos.test'", Boolean.class)).isTrue();

    // The support desk stays usable, so the admin workflow can be shown.
    var reply = http.perform(post("/api/v1/admin/support/tickets/t-demo/messages")
      .header("Authorization", "Bearer " + token).contentType(MediaType.APPLICATION_JSON).content("{\"body\":\"Demo reply\"}")).andReturn();
    assertThat(reply.getResponse().getContentAsString()).as("support desk must not be demo-blocked").doesNotContain("DEMO_MODE");
  }

  private String tokenFor(String email, String password) throws Exception {
    var login = callAs(null, post("/api/v1/auth/login"), "{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}", 200);
    var token = login.path("token").asText();
    assertThat(token).isNotBlank();
    return token;
  }

  private JsonNode callAs(String tok, MockHttpServletRequestBuilder b, String body, int expected) throws Exception {
    if (body != null) { b.content(body); b.contentType(MediaType.APPLICATION_JSON); }
    if (tok != null) b.header("Authorization", "Bearer " + tok);
    var result = http.perform(b).andExpect(status().is(expected)).andReturn();
    return json.readTree(result.getResponse().getContentAsString());
  }
}
