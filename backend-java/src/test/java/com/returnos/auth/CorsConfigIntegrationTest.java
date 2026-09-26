package com.returnos.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.returnos.ReturnOsApplication;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * CORS preflight for the deployed frontend.
 *
 * The production symptom this covers: OPTIONS /api/v1/auth/login answered 403
 * because the configured origin never matched. An Origin header is compared
 * exactly, so a value pasted into a dashboard with a space after the comma, or
 * with a trailing slash, silently allowed nothing. The origin list here is
 * written the way a deployment actually gets it wrong.
 */
@SpringBootTest(classes = ReturnOsApplication.class)
@AutoConfigureMockMvc
class CorsConfigIntegrationTest {
  static final String VERCEL = "https://returnos-sandy.vercel.app";

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

  @DynamicPropertySource static void config(DynamicPropertyRegistry r) {
    String externalUrl = System.getenv("TEST_DB_URL");
    if (externalUrl != null && !externalUrl.isBlank()) {
      r.add("spring.datasource.url", () -> externalUrl);
      r.add("spring.datasource.username", () -> envOr("TEST_DB_USERNAME", "postgres"));
      r.add("spring.datasource.password", () -> System.getenv("TEST_DB_PASSWORD"));
    } else {
      r.add("spring.datasource.url", postgres::getJdbcUrl);
      r.add("spring.datasource.username", postgres::getUsername);
      r.add("spring.datasource.password", postgres::getPassword);
    }
    r.add("returnos.jwt-secret", () -> "test-secret-with-at-least-thirty-two-characters");
    r.add("returnos.fulfillment-enabled", () -> "false");
    // Deliberately messy, exactly as a dashboard value tends to arrive:
    // a space after the comma, a trailing slash, and a stray empty entry.
    r.add("returnos.cors-origins", () -> "http://localhost:5173, " + VERCEL + "/, ");
  }

  static String envOr(String name, String fallback) {
    String v = System.getenv(name);
    return (v == null || v.isBlank()) ? fallback : v;
  }

  @Autowired MockMvc http;

  @Test void preflightForLoginAllowsTheDeployedFrontend() throws Exception {
    http.perform(options("/api/v1/auth/login")
        .header("Origin", VERCEL)
        .header("Access-Control-Request-Method", "POST")
        .header("Access-Control-Request-Headers", "content-type"))
      .andExpect(status().isOk())
      .andExpect(header().string("Access-Control-Allow-Origin", VERCEL))
      .andExpect(header().string("Access-Control-Allow-Credentials", "true"));
  }

  @Test void preflightSurvivesWhitespaceAndTrailingSlashInConfiguration() throws Exception {
    // localhost was configured without either flaw and must still work.
    http.perform(options("/api/v1/auth/login")
        .header("Origin", "http://localhost:5173")
        .header("Access-Control-Request-Method", "POST"))
      .andExpect(status().isOk())
      .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:5173"));
  }

  @Test void preflightOnAProtectedRouteIsNotBlockedByAuthentication() throws Exception {
    // Preflight carries no credentials, so it must be answered before the
    // authentication rules rather than rejected as unauthenticated.
    http.perform(options("/api/v1/orders")
        .header("Origin", VERCEL)
        .header("Access-Control-Request-Method", "GET"))
      .andExpect(status().isOk())
      .andExpect(header().string("Access-Control-Allow-Origin", VERCEL));
  }

  @Test void anUnknownOriginIsStillRejected() throws Exception {
    // The fix must not turn into a wildcard.
    http.perform(options("/api/v1/auth/login")
        .header("Origin", "https://not-our-frontend.example")
        .header("Access-Control-Request-Method", "POST"))
      .andExpect(status().isForbidden());
  }

  @Test void configuredOriginsAreNormalised() {
    assertThat(SecurityConfig.parseOrigins("http://localhost:5173, " + VERCEL + "/, "))
      .containsExactly("http://localhost:5173", VERCEL);
    assertThat(SecurityConfig.parseOrigins("  " + VERCEL + "  ")).containsExactly(VERCEL);
  }

  @Test void anEmptyOriginListFailsFastRatherThanAllowingNothing() {
    assertThat(org.junit.jupiter.api.Assertions.assertThrows(
        IllegalStateException.class, () -> SecurityConfig.parseOrigins("  ,  ")).getMessage())
      .contains("RETURNOS_CORS_ORIGINS");
  }
}
