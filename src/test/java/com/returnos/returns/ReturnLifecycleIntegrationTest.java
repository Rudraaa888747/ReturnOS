package com.returnos.returns;

import static org.assertj.core.api.Assertions.assertThat;
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

        // 6. receive
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/receive")
                        .header("Authorization", "Bearer " + staffToken))
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

        // rejected return cannot be received
        mockMvc.perform(post("/api/v1/returns/" + returnId + "/receive")
                        .header("Authorization", "Bearer " + staffToken))
                .andExpect(status().isUnprocessableEntity());
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
