package com.returnos;

import static org.assertj.core.api.Assertions.assertThat;
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
import java.util.ArrayList;
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
class Phase3IntegrationTest {

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
    private String staff2Token;
    private String adminToken;
    private Product product;
    private UUID orderId;
    private List<UUID> orderItemIds;

    @BeforeEach
    void setUp() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String customerEmail = "p3cust+" + suffix + "@returnos.test";
        String staffEmail = "p3staff+" + suffix + "@returnos.test";
        String staff2Email = "p3staff2+" + suffix + "@returnos.test";
        String adminEmail = "p3admin+" + suffix + "@returnos.test";

        users.save(new User(customerEmail, passwordEncoder.encode("Customer123!"), "Customer", Role.CUSTOMER));
        users.save(new User(staffEmail, passwordEncoder.encode("Staff12345!"), "Staff", Role.WAREHOUSE_STAFF));
        users.save(new User(staff2Email, passwordEncoder.encode("Staff12345!"), "Staff Two", Role.WAREHOUSE_STAFF));
        users.save(new User(adminEmail, passwordEncoder.encode("Admin12345!"), "Admin", Role.ADMIN));

        customerToken = login(customerEmail, "Customer123!");
        staffToken = login(staffEmail, "Staff12345!");
        staff2Token = login(staff2Email, "Staff12345!");
        adminToken = login(adminEmail, "Admin12345!");

        product = products.save(new Product(
                "SKU-P3-" + suffix, "P3 Widget", "electronics", "Phase 3 test product",
                new BigDecimal("999.00"), true));

        List<Map<String, Object>> items = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            items.add(Map.of("productId", product.getId().toString(), "quantity", 1));
        }
        String orderBody = objectMapper.writeValueAsString(Map.of("items", items));
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
        orderItemIds = new ArrayList<>();
        orderJson.get("items").forEach(n -> orderItemIds.add(UUID.fromString(n.get("id").asText())));

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

    private UUID createReturn(int itemIndex, String reason) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of(
                "orderId", orderId.toString(),
                "items", List.of(Map.of(
                        "orderItemId", orderItemIds.get(itemIndex).toString(), "quantity", 1, "reason", reason))));
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
                "notes", "Phase 3 test inspection"));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/inspection")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated());
    }

    private void assess(UUID returnId) throws Exception {
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/risk/assess")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isCreated());
    }

    private void evaluate(UUID returnId) throws Exception {
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/disposition/evaluate")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isCreated());
    }

    private void finalizeAsRecommended(UUID returnId) throws Exception {
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/disposition/finalize")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk());
    }

    private void startExecution(UUID returnId) throws Exception {
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/execution/start")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_PROGRESS"));
    }

    @Test
    void restockExecutionLifecycle() throws Exception {
        UUID returnId = createReturn(0, "CHANGED_MIND");
        approve(returnId);
        ship(returnId);
        receive(returnId, "SHIPPED");
        inspect(returnId, "EXCELLENT", "SEALED", "PASSED");
        assess(returnId);
        evaluate(returnId);
        finalizeAsRecommended(returnId);

        // Auto-created PENDING execution from finalization.
        mockMvc.perform(get("/api/v1/returns/" + returnId + "/execution")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING"));

        startExecution(returnId);

        // Completion without the channel record is rejected.
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/execution/complete")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("CHANNEL_RECORD_MISSING"));

        String restockBody = objectMapper.writeValueAsString(Map.of("destination", "Ahmedabad Warehouse"));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/restock")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(restockBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.destination").value("Ahmedabad Warehouse"))
                .andExpect(jsonPath("$.recoveredQuantity").value(1));

        // Duplicate restock must not double-count.
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/restock")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(restockBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("DUPLICATE_RESTOCK"));

        mockMvc.perform(post("/api/v1/returns/" + returnId + "/execution/complete")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"))
                .andExpect(jsonPath("$.durationSeconds").exists());

        // Duplicate completion rejected.
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/execution/complete")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isUnprocessableEntity());

        assertThat(auditLogs.findAll()).anyMatch(l -> l.getAction() == AuditAction.DISPOSITION_EXECUTION_STARTED);
        assertThat(auditLogs.findAll()).anyMatch(l -> l.getAction() == AuditAction.DISPOSITION_EXECUTION_COMPLETED);
        assertThat(auditLogs.findAll()).anyMatch(l -> l.getAction() == AuditAction.RESTOCK_COMPLETED);
    }

    @Test
    void executionFailFlow() throws Exception {
        UUID returnId = createReturn(1, "DAMAGED");
        approve(returnId);
        receive(returnId, "COUNTER");
        inspect(returnId, "GOOD", "OPENED", "PASSED");
        assess(returnId);
        evaluate(returnId);
        finalizeAsRecommended(returnId);
        startExecution(returnId);

        // Failure without reason is rejected by validation.
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/execution/fail")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"\"}"))
                .andExpect(status().isBadRequest());

        mockMvc.perform(post("/api/v1/returns/" + returnId + "/execution/fail")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"Forklift damaged the pallet\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("FAILED"))
                .andExpect(jsonPath("$.failureReason").value("Forklift damaged the pallet"));

        mockMvc.perform(post("/api/v1/returns/" + returnId + "/execution/complete")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isUnprocessableEntity());

        assertThat(auditLogs.findAll()).anyMatch(l -> l.getAction() == AuditAction.DISPOSITION_EXECUTION_FAILED);
    }

    @Test
    void vendorClaimFlow() throws Exception {
        UUID returnId = createReturn(2, "DEFECTIVE");
        approve(returnId);
        ship(returnId);
        receive(returnId, "SHIPPED");
        inspect(returnId, "DAMAGED", "OPENED", "FAILED");
        assess(returnId);

        mockMvc.perform(post("/api/v1/returns/" + returnId + "/disposition/evaluate")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.recommended").value("RETURN_TO_VENDOR"));
        finalizeAsRecommended(returnId);
        startExecution(returnId);

        String claimBody = objectMapper.writeValueAsString(
                Map.of("vendorReference", "VND-1001", "expectedCredit", 999.00));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/vendor-claim")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(claimBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.vendorReference").value("VND-1001"));

        // Duplicate claim protection.
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/vendor-claim")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(claimBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("DUPLICATE_CLAIM"));

        // Invalid transition: approve before submit/acknowledge.
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/vendor-claim/approve")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isUnprocessableEntity());

        mockMvc.perform(post("/api/v1/returns/" + returnId + "/vendor-claim/submit")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUBMITTED"));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/vendor-claim/acknowledge")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACKNOWLEDGED"));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/vendor-claim/approve")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"));
        String settleBody = objectMapper.writeValueAsString(Map.of("actualCredit", 950.00));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/vendor-claim/settle")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(settleBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SETTLED"))
                .andExpect(jsonPath("$.actualCredit").value(950.00));

        mockMvc.perform(post("/api/v1/returns/" + returnId + "/execution/complete")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"));

        assertThat(auditLogs.findAll()).anyMatch(l -> l.getAction() == AuditAction.VENDOR_CLAIM_CREATED);
        assertThat(auditLogs.findAll()).anyMatch(l -> l.getAction() == AuditAction.VENDOR_CLAIM_SUBMITTED);
        assertThat(auditLogs.findAll()).anyMatch(l -> l.getAction() == AuditAction.VENDOR_CLAIM_SETTLED);
    }

    @Test
    void recoveryFlowWithCorrection() throws Exception {
        UUID returnId = createReturn(3, "CHANGED_MIND");
        approve(returnId);
        ship(returnId);
        receive(returnId, "SHIPPED");
        inspect(returnId, "FAIR", "OPENED", "PASSED");
        assess(returnId);

        mockMvc.perform(post("/api/v1/returns/" + returnId + "/disposition/evaluate")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.recommended").value("RESELL"));
        finalizeAsRecommended(returnId);
        startExecution(returnId);

        String createBody =
                objectMapper.writeValueAsString(Map.of("channel", "open-box-store", "listedValue", 700.00));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/recovery")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.expectedRecovery").value(299.30));

        // Duplicate recovery protection.
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/recovery")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("DUPLICATE_RECOVERY"));

        mockMvc.perform(post("/api/v1/returns/" + returnId + "/recovery/list")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("LISTED"));

        String sellBody = objectMapper.writeValueAsString(Map.of("actualRecovered", 350.00, "fees", 20.00));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/recovery/sell")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(sellBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SOLD"))
                .andExpect(jsonPath("$.actualRecovered").value(350.00))
                .andExpect(jsonPath("$.netRecovered").value(330.00));

        mockMvc.perform(post("/api/v1/returns/" + returnId + "/recovery/settle")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SETTLED"));

        // Duplicate settlement rejected.
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/recovery/settle")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isUnprocessableEntity());

        // Staff cannot correct; admin can with mandatory reason.
        String correctBody =
                objectMapper.writeValueAsString(Map.of("actualRecovered", 360.00, "reason", "Buyer paid extra fee"));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/recovery/correct")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(correctBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/recovery/correct")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(correctBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.actualRecovered").value(360.00))
                .andExpect(jsonPath("$.netRecovered").value(340.00));

        mockMvc.perform(post("/api/v1/returns/" + returnId + "/execution/complete")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"));

        assertThat(auditLogs.findAll()).anyMatch(l -> l.getAction() == AuditAction.RECOVERY_SOLD);
        assertThat(auditLogs.findAll()).anyMatch(l -> l.getAction() == AuditAction.RECOVERY_SETTLED);
        assertThat(auditLogs.findAll()).anyMatch(l -> l.getAction() == AuditAction.OPERATIONAL_CORRECTION);
    }

    @Test
    void disposalFlowWithAdminOverrideToScrap() throws Exception {
        UUID returnId = createReturn(4, "OTHER");
        approve(returnId);
        ship(returnId);
        receive(returnId, "SHIPPED");
        inspect(returnId, "DAMAGED", "MISSING", "FAILED");
        assess(returnId);

        mockMvc.perform(post("/api/v1/returns/" + returnId + "/disposition/evaluate")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.recommended").value("LIQUIDATE"));

        String overrideBody = objectMapper.writeValueAsString(
                Map.of("disposition", "SCRAP", "reason", "Liability risk, destroy instead"));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/disposition/override")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(overrideBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.finalDisposition").value("SCRAP"));

        startExecution(returnId);

        String disposalBody =
                objectMapper.writeValueAsString(Map.of("partner", "GreenRecycle", "actualRecovery", 10.00));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/disposal/complete")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(disposalBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.disposition").value("SCRAP"));

        mockMvc.perform(post("/api/v1/returns/" + returnId + "/disposal/complete")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(disposalBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("DUPLICATE_DISPOSAL"));

        mockMvc.perform(post("/api/v1/returns/" + returnId + "/execution/complete")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"));

        assertThat(auditLogs.findAll()).anyMatch(l -> l.getAction() == AuditAction.SCRAP_COMPLETED);
    }

    @Test
    void taskAuthorizationAndLifecycle() throws Exception {
        UUID returnId = createReturn(0, "CHANGED_MIND");

        // Customers cannot create tasks.
        String createBody = objectMapper.writeValueAsString(
                Map.of("returnId", returnId.toString(), "type", "RESTOCK_ITEM"));
        mockMvc.perform(post("/api/v1/operations/tasks")
                        .header("Authorization", "Bearer " + customerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));

        String taskResp = mockMvc.perform(post("/api/v1/operations/tasks")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("OPEN"))
                .andReturn()
                .getResponse()
                .getContentAsString();
        UUID taskId = UUID.fromString(objectMapper.readTree(taskResp).get("id").asText());

        // Non-assignee staff (unassigned task: any operator) can start...
        mockMvc.perform(post("/api/v1/operations/tasks/" + taskId + "/start")
                        .header("Authorization", "Bearer " + staff2Token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_PROGRESS"));

        // ...and complete an unassigned task.
        mockMvc.perform(post("/api/v1/operations/tasks/" + taskId + "/complete")
                        .header("Authorization", "Bearer " + staff2Token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"));

        // Assigned task: only the assignee or an admin may complete it.
        String meResp = mockMvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", "Bearer " + staff2Token))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        String staff2Id = objectMapper.readTree(meResp).get("id").asText();

        String assignedResp = mockMvc.perform(post("/api/v1/operations/tasks")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "returnId", returnId.toString(),
                                "type", "PROCESS_RECYCLING",
                                "assigneeId", staff2Id))))
                .andExpect(status().isCreated())
                .andReturn()
                .getResponse()
                .getContentAsString();
        UUID assignedTaskId =
                UUID.fromString(objectMapper.readTree(assignedResp).get("id").asText());

        // Non-assignee staff is denied...
        mockMvc.perform(post("/api/v1/operations/tasks/" + assignedTaskId + "/complete")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));

        // ...the assignee completes.
        mockMvc.perform(post("/api/v1/operations/tasks/" + assignedTaskId + "/start")
                        .header("Authorization", "Bearer " + staff2Token))
                .andExpect(status().isOk());
        mockMvc.perform(post("/api/v1/operations/tasks/" + assignedTaskId + "/complete")
                        .header("Authorization", "Bearer " + staff2Token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"));

        mockMvc.perform(get("/api/v1/operations/tasks")
                        .header("Authorization", "Bearer " + staffToken)
                        .param("mine", "true"))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/v1/operations/tasks")
                        .header("Authorization", "Bearer " + customerToken))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));

        assertThat(auditLogs.findAll()).anyMatch(l -> l.getAction() == AuditAction.TASK_COMPLETED);
    }

    @Test
    void historyAndAnalytics() throws Exception {
        UUID returnId = createReturn(0, "CHANGED_MIND");
        approve(returnId);
        ship(returnId);
        receive(returnId, "SHIPPED");
        inspect(returnId, "EXCELLENT", "SEALED", "PASSED");
        assess(returnId);
        evaluate(returnId);
        finalizeAsRecommended(returnId);
        startExecution(returnId);
        String restockBody = objectMapper.writeValueAsString(Map.of("destination", "Main Warehouse"));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/restock")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(restockBody))
                .andExpect(status().isCreated());
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/execution/complete")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk());

        // Customer history: own return visible, actor identities stripped.
        String customerHistory = mockMvc.perform(get("/api/v1/returns/" + returnId + "/history")
                        .header("Authorization", "Bearer " + customerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.returnId").value(returnId.toString()))
                .andExpect(jsonPath("$.disposition.finalDisposition").value("RESTOCK"))
                .andExpect(jsonPath("$.execution.status").value("COMPLETED"))
                .andExpect(jsonPath("$.restock.destination").value("Main Warehouse"))
                .andExpect(jsonPath("$.events").isArray())
                .andReturn()
                .getResponse()
                .getContentAsString();
        JsonNode historyJson = objectMapper.readTree(customerHistory);
        assertThat(historyJson.get("events").size()).isGreaterThan(5);
        historyJson.get("events").forEach(e -> assertThat(e.get("actor").isNull()).isTrue());

        // Staff history keeps actor identities.
        String staffHistory = mockMvc.perform(get("/api/v1/returns/" + returnId + "/history")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        JsonNode staffJson = objectMapper.readTree(staffHistory);
        assertThat(staffJson.get("events").get(0).get("actor").asText()).isNotBlank();

        // Analytics (admin): aggregates reflect the completed RESTOCK flow.
        mockMvc.perform(get("/api/v1/admin/analytics/returns")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.finalized").value(1))
                .andExpect(jsonPath("$.byFinalDisposition.RESTOCK").value(1))
                .andExpect(jsonPath("$.executionsCompleted").value(1));
        mockMvc.perform(get("/api/v1/admin/analytics/recovery")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.restockRecords").value(1))
                .andExpect(jsonPath("$.restockQuantity").value(1));

        // Non-admin analytics denied.
        mockMvc.perform(get("/api/v1/admin/analytics/returns")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/v1/admin/analytics/returns")
                        .header("Authorization", "Bearer " + customerToken))
                .andExpect(status().isForbidden());
    }

    @Test
    void emptyAnalyticsReturnsZeroes() throws Exception {
        // Fresh test transaction: setup order exists but nothing evaluated/finalized.
        String returnsResp = mockMvc.perform(get("/api/v1/admin/analytics/returns")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        JsonNode returnsJson = objectMapper.readTree(returnsResp);
        assertThat(returnsJson.get("finalized").asLong()).isZero();
        assertThat(returnsJson.get("executionCompletionRate").asDouble()).isZero();
        assertThat(returnsJson.get("byFinalDisposition").size()).isZero();

        String recoveryResp = mockMvc.perform(get("/api/v1/admin/analytics/recovery")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        JsonNode recoveryJson = objectMapper.readTree(recoveryResp);
        assertThat(recoveryJson.get("expectedRecovery").asDouble()).isZero();
        assertThat(recoveryJson.get("vendorSettlementRate").asDouble()).isZero();
    }

    @Test
    void executionRequiresFinalDisposition() throws Exception {
        UUID returnId = createReturn(0, "DEFECTIVE");
        approve(returnId);

        mockMvc.perform(post("/api/v1/returns/" + returnId + "/execution/start")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("DISPOSITION_NOT_FOUND"));

        // Customer can never start executions.
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/execution/start")
                        .header("Authorization", "Bearer " + customerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }
}
