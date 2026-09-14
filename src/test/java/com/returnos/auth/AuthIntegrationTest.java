package com.returnos.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import com.returnos.user.Role;
import com.returnos.user.User;
import com.returnos.user.UserRepository;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class AuthIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private UserRepository users;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private String uniqueEmail(String prefix) {
        return prefix + "+" + UUID.randomUUID().toString().substring(0, 8) + "@returnos.test";
    }

    @BeforeEach
    void seedAdmin() {
        if (!users.existsByEmail("admin@test.returnos")) {
            users.save(new User("admin@test.returnos", passwordEncoder.encode("Admin12345!"), "Admin", Role.ADMIN));
        }
    }

    @Test
    void registerAndLoginAndMe() throws Exception {
        String email = uniqueEmail("customer");

        String registerBody = objectMapper.writeValueAsString(
                java.util.Map.of("email", email, "password", "Customer123!", "fullName", "Test Customer"));

        String registerResponse = mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andExpect(jsonPath("$.user.email").value(email))
                .andExpect(jsonPath("$.user.role").value("CUSTOMER"))
                .andReturn()
                .getResponse()
                .getContentAsString();

        JsonNode registerJson = objectMapper.readTree(registerResponse);
        String token = registerJson.get("token").asText();
        assertThat(token).isNotBlank();

        // me with token
        mockMvc.perform(get("/api/v1/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(email));

        // me without token -> 401/403
        mockMvc.perform(get("/api/v1/auth/me")).andExpect(status().is4xxClientError());

        // login
        String loginBody = objectMapper.writeValueAsString(
                java.util.Map.of("email", email, "password", "Customer123!"));
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isNotEmpty());
    }

    @Test
    void duplicateRegistrationIsRejected() throws Exception {
        String email = uniqueEmail("dup");
        String body = objectMapper.writeValueAsString(
                java.util.Map.of("email", email, "password", "Customer123!", "fullName", "Dup User"));

        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated());

        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("EMAIL_TAKEN"));
    }

    @Test
    void validationFailuresReturnConsistentError() throws Exception {
        String body = objectMapper.writeValueAsString(
                java.util.Map.of("email", "not-an-email", "password", "short", "fullName", ""));
        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors").isMap());
    }

    @Test
    void loginWithWrongPasswordIsUnauthorized() throws Exception {
        String email = uniqueEmail("badpass");
        String body = objectMapper.writeValueAsString(
                java.util.Map.of("email", email, "password", "Customer123!", "fullName", "Bad Pass"));
        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated());

        String loginBody = objectMapper.writeValueAsString(
                java.util.Map.of("email", email, "password", "WrongPassword1!"));
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void customerCannotCreateProductButAdminCan() throws Exception {
        String customerEmail = uniqueEmail("cust");
        String regBody = objectMapper.writeValueAsString(
                java.util.Map.of("email", customerEmail, "password", "Customer123!", "fullName", "Cust"));
        String regResp = mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(regBody))
                .andExpect(status().isCreated())
                .andReturn()
                .getResponse()
                .getContentAsString();
        String customerToken = objectMapper.readTree(regResp).get("token").asText();

        String productBody = objectMapper.writeValueAsString(java.util.Map.of(
                "sku", "SKU-AUTH-" + UUID.randomUUID().toString().substring(0, 6),
                "name", "Auth Test Product",
                "category", "electronics",
                "price", 100.00));

        // customer -> forbidden
        mockMvc.perform(post("/api/v1/products")
                        .header("Authorization", "Bearer " + customerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(productBody))
                .andExpect(status().isForbidden());

        // admin login
        String adminLogin = objectMapper.writeValueAsString(
                java.util.Map.of("email", "admin@test.returnos", "password", "Admin12345!"));
        String adminResp = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(adminLogin))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        String adminToken = objectMapper.readTree(adminResp).get("token").asText();

        mockMvc.perform(post("/api/v1/products")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(productBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.sku").isNotEmpty());
    }
}
