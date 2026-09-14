package com.returnos.returns;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.CoreMatchers.is;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
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
class ReturnLifecycleIntegrationTest {

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
    private Product product;
    private UUID deliveredOrderId;
    private UUID deliveredOrderItemId;

    @BeforeEach
    void setUp() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String customerEmail = "cust+" + suffix + "@returnos.test";
        String staffEmail = "staff+" + suffix + "@returnos.test";

        users.save(new User(customerEmail, passwordEncoder.encode("Customer123!"), "Customer", Role.CUSTOMER));
        users.save(new User(staffEmail, passwordEncoder.encode("Staff12345!"), "Staff", Role.WAREHOUSE_STAFF));

        customerToken = login(customerEmail, "Customer123!");
        staffToken = login(staffEmail, "Staff12345!");

        product = products.save(new Product(
                "SKU-TEST-" + suffix, "Test Headphones", "electronics", "Test product",
                new BigDecimal("999.00"), true));

        // customer places order
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
        deliveredOrderId = UUID.fromString(orderJson.get("id").asText());
        deliveredOrderItemId = UUID.fromString(orderJson.get("items").get(0).get("id").asText());

        // staff delivers
        mockMvc.perform(post("/api/v1/orders/" + deliveredOrderId + "/deliver")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DELIVERED"));
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

    @Test
    void fullLifecycleApproveShipReceiveInspect() throws Exception {
        // 1. request return
        String returnBody = objectMapper.writeValueAsString(Map.of(
                "orderId", deliveredOrderId.toString(),
                "items", List.of(Map.of(
                        "orderItemId", deliveredOrderItemId.toString(),
                        "quantity", 1,
                        "reason", "DEFECTIVE",
                        "description", "Speaker crackling"))));
        String returnResp = mockMvc.perform(post("/api/v1/returns")
                        .header("Authorization", "Bearer " + customerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(returnBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("REQUESTED"))
                .andReturn()
                .getResponse()
                .getContentAsString();
        UUID returnId = UUID.fromString(objectMapper.readTree(returnResp).get("id").asText());

        assertThat(auditLogs.findAll()).anyMatch(l ->
                l.getAction() == AuditAction.RETURN_CREATED && l.getEntityId().equals(returnId.toString()));

        // 2. approve
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/approve")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"));

        // 3. invalid: approve again -> 422
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/approve")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INVALID_TRANSITION"));

        // 4. invalid: inspect before receive -> 422
        String inspectionBody = objectMapper.writeValueAsString(Map.of(
                "physicalCondition", "GOOD",
                "packagingCondition", "OPENED",
                "accessoriesComplete", true,
                "functionalTestResult", "FAILED",
                "notes", "Speaker fails at high volume"));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/inspection")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(inspectionBody))
                .andExpect(status().isUnprocessableEntity());

        // 5. ship
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/ship")
                        .header("Authorization", "Bearer " + customerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_TRANSIT"));

        // 6. receive as carrier shipment
        String receiveBody = objectMapper.writeValueAsString(Map.of("mode", "SHIPPED"));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/receive")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(receiveBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("INSPECTION_PENDING"))
                .andExpect(jsonPath("$.receivedAt").isNotEmpty());

        // 7. inspect
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/inspection")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(inspectionBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.physicalCondition").value("GOOD"));

        // 8. return is now completed
        mockMvc.perform(get("/api/v1/returns/" + returnId)
                        .header("Authorization", "Bearer " + customerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("INSPECTION_COMPLETED"));

        // 9. get inspection
        mockMvc.perform(get("/api/v1/returns/" + returnId + "/inspection")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.functionalTestResult").value("FAILED"));

        // 10. audit trail
        assertThat(auditLogs.findAll()).anyMatch(l -> l.getAction() == AuditAction.RETURN_RECEIVED);
        assertThat(auditLogs.findAll()).anyMatch(l -> l.getAction() == AuditAction.INSPECTION_STARTED);
        assertThat(auditLogs.findAll()).anyMatch(l -> l.getAction() == AuditAction.INSPECTION_COMPLETED);
    }

    @Test
    void rejectFlow() throws Exception {
        UUID returnId = createReturn(deliveredOrderId, deliveredOrderItemId, 1, "WRONG_ITEM");

        String rejectBody = objectMapper.writeValueAsString(Map.of("reason", "Item was actually correct per photo"));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/reject")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(rejectBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REJECTED"))
                .andExpect(jsonPath("$.rejectionReason").isNotEmpty());

        // rejected return cannot be received (neither channel)
        String counterBody = objectMapper.writeValueAsString(Map.of("mode", "COUNTER"));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/receive")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(counterBody))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INVALID_TRANSITION"));
    }

    @Test
    void returnForUndeliveredOrderIsRejected() throws Exception {
        // place a new order but do NOT deliver
        String orderBody = objectMapper.writeValueAsString(Map.of(
                "items", List.of(Map.of("productId", product.getId().toString(), "quantity", 1))));
        String orderResp = mockMvc.perform(post("/api/v1/orders")
                        .header("Authorization", "Bearer " + customerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(orderBody))
                .andExpect(status().isCreated())
                .andReturn()
                .getResponse()
                .getContentAsString();
        JsonNode orderJson = objectMapper.readTree(orderResp);
        UUID orderId = UUID.fromString(orderJson.get("id").asText());
        UUID orderItemId = UUID.fromString(orderJson.get("items").get(0).get("id").asText());

        String returnBody = objectMapper.writeValueAsString(Map.of(
                "orderId", orderId.toString(),
                "items", List.of(Map.of(
                        "orderItemId", orderItemId.toString(), "quantity", 1, "reason", "DAMAGED"))));
        mockMvc.perform(post("/api/v1/returns")
                        .header("Authorization", "Bearer " + customerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(returnBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("RETURN_NOT_ELIGIBLE"));
    }

    @Test
    void quantityExceededIsRejected() throws Exception {
        String returnBody = objectMapper.writeValueAsString(Map.of(
                "orderId", deliveredOrderId.toString(),
                "items", List.of(Map.of(
                        "orderItemId", deliveredOrderItemId.toString(),
                        "quantity", 99,
                        "reason", "DAMAGED"))));
        mockMvc.perform(post("/api/v1/returns")
                        .header("Authorization", "Bearer " + customerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(returnBody))
                .andExpect(status().isBadRequest());
    }

    @Test
    void customerStatusFilterPaginatesCorrectly() throws Exception {
        // One order with 4 line items so the customer owns 4 returns.
        String orderBody = objectMapper.writeValueAsString(Map.of(
                "items", List.of(
                        Map.of("productId", product.getId().toString(), "quantity", 1),
                        Map.of("productId", product.getId().toString(), "quantity", 1),
                        Map.of("productId", product.getId().toString(), "quantity", 1),
                        Map.of("productId", product.getId().toString(), "quantity", 1))));
        String orderResp = mockMvc.perform(post("/api/v1/orders")
                        .header("Authorization", "Bearer " + customerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(orderBody))
                .andExpect(status().isCreated())
                .andReturn()
                .getResponse()
                .getContentAsString();
        JsonNode orderJson = objectMapper.readTree(orderResp);
        UUID orderId = UUID.fromString(orderJson.get("id").asText());
        List<UUID> orderItemIds = new ArrayList<>();
        orderJson.get("items").forEach(n -> orderItemIds.add(UUID.fromString(n.get("id").asText())));

        mockMvc.perform(post("/api/v1/orders/" + orderId + "/deliver")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk());

        List<UUID> returnIds = new ArrayList<>();
        for (UUID orderItemId : orderItemIds) {
            returnIds.add(createReturn(orderId, orderItemId, 1, "DEFECTIVE"));
        }
        // 3 APPROVED, 1 REJECTED
        for (int i = 0; i < 3; i++) {
            mockMvc.perform(post("/api/v1/returns/" + returnIds.get(i) + "/approve")
                            .header("Authorization", "Bearer " + staffToken))
                    .andExpect(status().isOk());
        }
        String rejectBody = objectMapper.writeValueAsString(Map.of("reason", "Not eligible for return"));
        mockMvc.perform(post("/api/v1/returns/" + returnIds.get(3) + "/reject")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(rejectBody))
                .andExpect(status().isOk());

        // Page 1 of APPROVED (2 of 3 total) - filtering must happen in the database,
        // so totalElements/totalPages reflect all matching rows, not just the page.
        mockMvc.perform(get("/api/v1/returns")
                        .header("Authorization", "Bearer " + customerToken)
                        .param("status", "APPROVED")
                        .param("size", "2")
                        .param("page", "0"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.content", hasSize(2)))
                .andExpect(jsonPath("$.content[*].status", everyItem(is("APPROVED"))));

        // Page 2 of APPROVED (remaining 1)
        mockMvc.perform(get("/api/v1/returns")
                        .header("Authorization", "Bearer " + customerToken)
                        .param("status", "APPROVED")
                        .param("size", "2")
                        .param("page", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.content", hasSize(1)))
                .andExpect(jsonPath("$.content[*].status", everyItem(is("APPROVED"))));

        // REJECTED filter finds the single rejected return.
        mockMvc.perform(get("/api/v1/returns")
                        .header("Authorization", "Bearer " + customerToken)
                        .param("status", "REJECTED"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[*].status", everyItem(is("REJECTED"))));

        // No filter sees all 4 returns.
        mockMvc.perform(get("/api/v1/returns")
                        .header("Authorization", "Bearer " + customerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(4));
    }

    @Test
    void counterReceiveFlow() throws Exception {
        UUID returnId = createReturn(deliveredOrderId, deliveredOrderItemId, 1, "WRONG_SIZE");

        mockMvc.perform(post("/api/v1/returns/" + returnId + "/approve")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"));

        // Counter/drop-off: APPROVED -> RECEIVED directly, no shipping step involved.
        String counterBody = objectMapper.writeValueAsString(Map.of("mode", "COUNTER"));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/receive")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(counterBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("INSPECTION_PENDING"))
                .andExpect(jsonPath("$.receivedAt").isNotEmpty());

        // Audit must distinguish the counter channel from a carrier shipment.
        assertThat(auditLogs.findAll()).anyMatch(l ->
                l.getAction() == AuditAction.RETURN_RECEIVED
                        && l.getEntityId().equals(returnId.toString())
                        && l.getReason() != null
                        && l.getReason().contains("counter/drop-off"));

        // Inspection still completes normally after a counter receive.
        String inspectionBody = objectMapper.writeValueAsString(Map.of(
                "physicalCondition", "EXCELLENT",
                "packagingCondition", "SEALED",
                "accessoriesComplete", true,
                "functionalTestResult", "NOT_TESTED",
                "notes", "Counter drop-off, looks untouched"));
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/inspection")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(inspectionBody))
                .andExpect(status().isCreated());

        mockMvc.perform(get("/api/v1/returns/" + returnId)
                        .header("Authorization", "Bearer " + customerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("INSPECTION_COMPLETED"));
    }

    @Test
    void receiveModeMismatchIsRejected() throws Exception {
        String shippedBody = objectMapper.writeValueAsString(Map.of("mode", "SHIPPED"));
        String counterBody = objectMapper.writeValueAsString(Map.of("mode", "COUNTER"));

        // Return A stays APPROVED: carrier mode must be rejected, counter mode accepted.
        UUID returnA = createReturn(deliveredOrderId, deliveredOrderItemId, 1, "DAMAGED");
        mockMvc.perform(post("/api/v1/returns/" + returnA + "/approve")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/returns/" + returnA + "/receive")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(shippedBody))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INVALID_TRANSITION"));

        // Return B goes IN_TRANSIT: counter mode must be rejected, carrier mode accepted.
        UUID returnB = createReturn(deliveredOrderId, deliveredOrderItemId, 1, "DEFECTIVE");
        mockMvc.perform(post("/api/v1/returns/" + returnB + "/approve")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isOk());
        mockMvc.perform(post("/api/v1/returns/" + returnB + "/ship")
                        .header("Authorization", "Bearer " + customerToken))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/returns/" + returnB + "/receive")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(counterBody))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INVALID_TRANSITION"));

        mockMvc.perform(post("/api/v1/returns/" + returnB + "/receive")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(shippedBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("INSPECTION_PENDING"));

        assertThat(auditLogs.findAll()).anyMatch(l ->
                l.getAction() == AuditAction.RETURN_RECEIVED
                        && l.getEntityId().equals(returnB.toString())
                        && l.getReason() != null
                        && l.getReason().contains("carrier shipment"));

        // Missing body is ambiguous and must be rejected, not guessed.
        mockMvc.perform(post("/api/v1/returns/" + returnA + "/receive")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MALFORMED_REQUEST"));

        // Wrong content type must not leak a 500.
        mockMvc.perform(post("/api/v1/returns/" + returnA + "/receive")
                        .header("Authorization", "Bearer " + staffToken)
                        .contentType(MediaType.TEXT_PLAIN)
                        .content("{\"mode\":\"COUNTER\"}"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.code").value("UNSUPPORTED_MEDIA_TYPE"));
    }

    private UUID createReturn(UUID orderId, UUID orderItemId, int qty, String reason) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of(
                "orderId", orderId.toString(),
                "items", List.of(Map.of(
                        "orderItemId", orderItemId.toString(), "quantity", qty, "reason", reason))));
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
}
