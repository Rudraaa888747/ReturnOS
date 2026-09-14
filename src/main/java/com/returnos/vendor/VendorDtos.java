package com.returnos.vendor;

import com.returnos.returns.ReturnReason;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public final class VendorDtos {

    private VendorDtos() {}

    public record VendorClaimResponse(
            UUID id,
            UUID returnId,
            UUID executionId,
            UUID productId,
            int quantity,
            ReturnReason reason,
            VendorClaimStatus status,
            String vendorReference,
            BigDecimal expectedCredit,
            BigDecimal actualCredit,
            String notes,
            Instant createdAt,
            Instant submittedAt,
            Instant acknowledgedAt,
            Instant decidedAt,
            Instant settledAt) {
        public static VendorClaimResponse from(VendorClaim claim) {
            return new VendorClaimResponse(
                    claim.getId(),
                    claim.getProductReturn().getId(),
                    claim.getExecution().getId(),
                    claim.getProduct().getId(),
                    claim.getQuantity(),
                    claim.getReason(),
                    claim.getStatus(),
                    claim.getVendorReference(),
                    claim.getExpectedCredit(),
                    claim.getActualCredit(),
                    claim.getNotes(),
                    claim.getCreatedAt(),
                    claim.getSubmittedAt(),
                    claim.getAcknowledgedAt(),
                    claim.getDecidedAt(),
                    claim.getSettledAt());
        }
    }

    @Schema(description = "Opens a vendor claim (DRAFT). One claim per execution.")
    public record CreateClaimRequest(
            @Size(max = 255) String vendorReference,
            @DecimalMin(value = "0.0", inclusive = true) BigDecimal expectedCredit,
            @Size(max = 2000) String notes) {}

    public record RejectClaimRequest(@Size(min = 3, max = 1000) String reason) {}

    @Schema(description = "Settles an approved claim. Actual credit defaults to the expected credit.")
    public record SettleClaimRequest(
            @DecimalMin(value = "0.0", inclusive = true) BigDecimal actualCredit,
            @Size(max = 2000) String notes) {}
}
