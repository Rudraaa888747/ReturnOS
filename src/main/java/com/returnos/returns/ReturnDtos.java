package com.returnos.returns;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class ReturnDtos {

    private ReturnDtos() {}

    public record CreateReturnItemRequest(
            @NotNull UUID orderItemId,
            @Min(1) int quantity,
            @NotNull ReturnReason reason,
            @Size(max = 1000) String description) {}

    public record CreateReturnRequest(
            @NotNull UUID orderId,
            @NotEmpty List<CreateReturnItemRequest> items) {}

    public record RejectReturnRequest(
            @NotNull @Size(min = 3, max = 1000) String reason) {}

    @Schema(description = "Declares how the goods arrived so the correct receive path is enforced")
    public record ReceiveReturnRequest(
            @NotNull @Schema(description = "SHIPPED for carrier delivery (requires IN_TRANSIT), "
                    + "COUNTER for in-person drop-off (requires APPROVED)") ReceiveMode mode) {}

    public record ReturnItemResponse(
            UUID id, UUID orderItemId, UUID productId, String sku,
            int quantity, ReturnReason reason, String description) {
        public static ReturnItemResponse from(ReturnItem item) {
            return new ReturnItemResponse(
                    item.getId(),
                    item.getOrderItem().getId(),
                    item.getProduct().getId(),
                    item.getProduct().getSku(),
                    item.getQuantity(),
                    item.getReason(),
                    item.getDescription());
        }
    }

    public record ReturnResponse(
            UUID id, String returnNumber, UUID orderId, UUID customerId,
            ReturnStatus status, Instant requestedAt,
            Instant approvedAt, Instant rejectedAt, String rejectionReason,
            Instant receivedAt, Instant createdAt,
            List<ReturnItemResponse> items) {
        public static ReturnResponse from(Return r) {
            return new ReturnResponse(
                    r.getId(), r.getReturnNumber(),
                    r.getOrder().getId(), r.getCustomer().getId(),
                    r.getStatus(), r.getRequestedAt(),
                    r.getApprovedAt(), r.getRejectedAt(), r.getRejectionReason(),
                    r.getReceivedAt(), r.getCreatedAt(),
                    r.getItems().stream().map(ReturnItemResponse::from).toList());
        }
    }
}
