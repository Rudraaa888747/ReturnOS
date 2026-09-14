package com.returnos.disposal;

import com.returnos.disposition.Disposition;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public final class DisposalDtos {

    private DisposalDtos() {}

    public record DisposalResponse(
            UUID id,
            UUID returnId,
            UUID executionId,
            Disposition disposition,
            int quantity,
            String partner,
            BigDecimal estimatedRecovery,
            BigDecimal actualRecovery,
            BigDecimal processingCost,
            Instant completedAt,
            String notes,
            UUID completedBy) {
        public static DisposalResponse from(DisposalRecord record) {
            return new DisposalResponse(
                    record.getId(),
                    record.getProductReturn().getId(),
                    record.getExecution().getId(),
                    record.getDisposition(),
                    record.getQuantity(),
                    record.getPartner(),
                    record.getEstimatedRecovery(),
                    record.getActualRecovery(),
                    record.getProcessingCost(),
                    record.getCompletedAt(),
                    record.getNotes(),
                    record.getCompletedBy() != null ? record.getCompletedBy().getId() : null);
        }
    }

    @Schema(description = "Completes recycling/scrapping in one step. One record per execution.")
    public record CompleteDisposalRequest(
            @Min(1) Integer quantity,
            @Size(max = 255) String partner,
            @DecimalMin(value = "0.0", inclusive = true) BigDecimal estimatedRecovery,
            @DecimalMin(value = "0.0", inclusive = true) BigDecimal actualRecovery,
            @DecimalMin(value = "0.0", inclusive = true) BigDecimal processingCost,
            @Size(max = 2000) String notes) {}
}
