package com.returnos.inventory;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

public final class InventoryDtos {

    private InventoryDtos() {}

    public record InventoryRecoveryResponse(
            UUID id,
            UUID returnId,
            UUID executionId,
            UUID productId,
            String sku,
            int quantity,
            int recoveredQuantity,
            String destination,
            InventoryAction action,
            UUID recordedBy,
            Instant recordedAt) {
        public static InventoryRecoveryResponse from(InventoryRecovery recovery) {
            return new InventoryRecoveryResponse(
                    recovery.getId(),
                    recovery.getProductReturn().getId(),
                    recovery.getExecution().getId(),
                    recovery.getProduct().getId(),
                    recovery.getProduct().getSku(),
                    recovery.getQuantity(),
                    recovery.getRecoveredQuantity(),
                    recovery.getDestination(),
                    recovery.getAction(),
                    recovery.getRecordedBy() != null ? recovery.getRecordedBy().getId() : null,
                    recovery.getRecordedAt());
        }
    }

    @Schema(description = "Records restocked goods. Quantities default to the returned total.")
    public record RestockRequest(
            @Min(1) Integer quantity,
            @Min(0) Integer recoveredQuantity,
            @NotBlank @Size(max = 255) String destination) {}
}
