package com.returnos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.CoreMatchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.returnos.audit.AuditAction;
import com.returnos.audit.AuditLogRepository;
import com.returnos.product.Product;
import com.returnos.product.ProductRepository;
import com.returnos.user.Role;
import com.returnos.user.User;
import com.returnos.user.UserRepository;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class Phase2IntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private UserRepository users;

    @Autowired
    private ProductRepository products;

    @Autowired
    private AuditLogRepository auditLogs;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private String customerToken;
    private String staffToken;
    private String adminToken;
    private Product product;
    private UUID orderId;
    private UUID orderItemId;

    @BeforeEach
    void setUp() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String customerEmail = "p2cust+" + suffix + "@returnos.test";
        String staffEmail = "p2staff+" + suffix + "@returnos.test";
        String adminEmail = "p2admin+" + suffix + "@returnos.test";

        users.save(new User(customerEmail, passwordEncoder.encode("Customer123!"), "Customer", Role.CUSTOMER));
        users.save(new User(staffEmail, passwordEncoder.encode("Staff12345!"), "Staff", Role.WAREHOUSE_STAFF));
        users.save(new User(adminEmail, passwordEncoder.encode("Admin12345!"), "Admin", Role.ADMIN));

        customerToken = login(customerEmail, "Customer123!");
        staffToken = login(staffEmail, "Staff12345!");
        adminToken = login(adminEmail, "Admin12345!");

        product = products.save(new Product(
                "SKU-P2-" + suffix, "P2 Widget", "electronics", "Phase 2 test product",
                new BigDecimal("999.00"), true));

        String orderBody = objectMapper.writeValueAsString(Map.of(
                "items", List.of(Map.of("productId", product.getId().toString(), "quantity", 2))));
        String orderResp = mockMvc.perform(post("/api/v1/orders")
                        .header("Authorization", "Bearer " + customerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(orderBody))
                .andExpect(status().isCreated())
                .andReturn()
                .getResponse()
                .getContentAsString();
        JsonNode orderJson = objectMapper.readTree(orderResp);
        orderId = UUID.fromString(orderJson.get("id").asText());
        orderItemId = UUID.fromString(orderJson.get("items").get(0).get("id").asText());

        mockMvc.perform(post("/api/v1/orders/" + orderId + "/deliver")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk());
    }

    private String login(String email, String password) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("email", email, "password", password));
        String resp = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return objectMapper.readTree(resp).get("token").asText();
    }

    private UUID createReturn(UUID orderId, UUID orderItemId, String reason) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of(
                "orderId", orderId.toString(),
                "items", List.of(Map.of(
                        "orderItemId", orderItemId.toString(), "quantity", 1, "reason", reason))));
        String resp = mockMvc.perform(post("/api/v1/returns")
                        .header("Authorization", "Bearer " + customerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return UUID.fromString(objectMapper.readTree(resp).get("id").asText());
    }

    private void approve(UUID returnId) throws Exception {
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/approve")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk());
    }

    private void ship(UUID returnId) throws Exception {
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/ship")
                        .header("Authorization", "Bearer " + customerToken))
                .andExpect(status().isOk());
    }

    private void receive(UUID returnId, String mode) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("mode", mode));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/receive")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    private void inspect(UUID returnId, String physical, String packaging, String functional) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of(
                "physicalCondition", physical,
                "packagingCondition", packaging,
                "accessoriesComplete", true,
                "functionalTestResult", functional,
                "notes", "Phase 2 test inspection"));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/inspection")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated());
    }

    @Test
    void riskAndDispositionRequireCompletedInspection() throws Exception {
        UUID returnId = createReturn(orderId, orderItemId, "DEFECTIVE");
        approve(returnId);

        mockMvc.perform(post("/api/v1/returns/" + returnId + "/risk/assess")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INSPECTION_INCOMPLETE"));

        mockMvc.perform(post("/api/v1/returns/" + returnId + "/disposition/evaluate")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INSPECTION_INCOMPLETE"));
    }

    @Test
    void fullRiskAndDispositionLifecycle() throws Exception {
        UUID returnId = createReturn(orderId, orderItemId, "DEFECTIVE");
        approve(returnId);
        ship(returnId);
        receive(returnId, "SHIPPED");
        inspect(returnId, "DAMAGED", "OPENED", "FAILED");

        // Risk: 201 first, 200 repeat (idempotent), explainable factors.
        String assessResp = mockMvc.perform(post("/api/v1/returns/" + returnId + "/risk/assess")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.factors").isArray())
                .andReturn()
                .getResponse()
                .getContentAsString();
        JsonNode riskJson = objectMapper.readTree(assessResp);
        assertThat(riskJson.get("score").asInt()).isGreaterThanOrEqualTo(0);
        assertThat(riskJson.get("level").asText()).isNotBlank();
        assertThat(riskJson.get("factors").isArray()).isTrue();
        UUID assessmentId = UUID.fromString(riskJson.get("id").asText());

        mockMvc.perform(post("/api/v1/returns/" + returnId + "/risk/assess")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(assessmentId.toString()));

        mockMvc.perform(get("/api/v1/returns/" + returnId + "/risk")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(assessmentId.toString()));

        // Customer may read but never assess.
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/risk/assess")
                        .header("Authorization", "Bearer " + customerToken))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
        mockMvc.perform(get("/api/v1/returns/" + returnId + "/risk")
                        .header("Authorization", "Bearer " + customerToken))
                .andExpect(status().isOk());

        // Disposition: 201 first, 200 repeat, candidates explain the recommendation.
        // DAMAGED + FAILED + DEFECTIVE inside vendor window -> RETURN_TO_VENDOR.
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/disposition/evaluate")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.recommended").value("RETURN_TO_VENDOR"))
                .andExpect(jsonPath("$.candidates").isArray())
                .andExpect(jsonPath("$.finalDisposition", nullValue()));

        mockMvc.perform(post("/api/v1/returns/" + returnId + "/disposition/evaluate")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recommended").value("RETURN_TO_VENDOR"));

        // Staff finalizes as recommended (empty body): no override recorded.
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/disposition/finalize")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.finalDisposition").value("RETURN_TO_VENDOR"))
                .andExpect(jsonPath("$.overridden").value(false));

        // Duplicate finalization is rejected safely.
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/disposition/finalize")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("ALREADY_FINALIZED"));

        assertThat(auditLogs.findAll()).anyMatch(l -> l.getAction() == AuditAction.RISK_ASSESSMENT_CREATED);
        assertThat(auditLogs.findAll()).anyMatch(l -> l.getAction() == AuditAction.DISPOSITION_EVALUATED);
        assertThat(auditLogs.findAll()).anyMatch(l -> l.getAction() == AuditAction.DISPOSITION_RECOMMENDED);
        assertThat(auditLogs.findAll()).anyMatch(l -> l.getAction() == AuditAction.FINAL_DISPOSITION_RECORDED);
    }

    @Test
    void adminOverrideFlow() throws Exception {
        UUID returnId = createReturn(orderId, orderItemId, "CHANGED_MIND");
        approve(returnId);
        receive(returnId, "COUNTER");
        inspect(returnId, "EXCELLENT", "SEALED", "PASSED");

        // Pristine change-of-mind item -> RESTOCK recommended.
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/disposition/evaluate")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.recommended").value("RESTOCK"));

        // Staff cannot override to a different channel.
        String staffOverride = objectMapper.writeValueAsString(
                Map.of("disposition", "LIQUIDATE", "overrideReason", "Staff wants out"));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/disposition/finalize")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(staffOverride))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));

        // Admin override without reason fails validation.
        String noReason = objectMapper.writeValueAsString(Map.of("disposition", "LIQUIDATE", "reason", ""));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/disposition/override")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(noReason))
                .andExpect(status().isBadRequest());

        // Admin override with reason succeeds; recommendation preserved.
        String override = objectMapper.writeValueAsString(
                Map.of("disposition", "LIQUIDATE", "reason", "Refurbishment partner unavailable"));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/disposition/override")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(override))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recommended").value("RESTOCK"))
                .andExpect(jsonPath("$.finalDisposition").value("LIQUIDATE"))
                .andExpect(jsonPath("$.overridden").value(true))
                .andExpect(jsonPath("$.overrideReason").value("Refurbishment partner unavailable"));

        assertThat(auditLogs.findAll()).anyMatch(l ->
                l.getAction() == AuditAction.DISPOSITION_OVERRIDDEN
                        && l.getEntityId().equals(returnId.toString()));
    }

    @Test
    void unknownReturnIdsReturn404() throws Exception {
        UUID unknown = UUID.randomUUID();
        mockMvc.perform(get("/api/v1/returns/" + unknown + "/risk")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/returns/" + unknown + "/disposition")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isNotFound());
    }
}
