package com.returnos.recovery;

import com.returnos.disposition.Disposition;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public final class RecoveryDtos {

    private RecoveryDtos() {}

    public record RecoveryResponse(
            UUID id,
            UUID returnId,
            UUID executionId,
            Disposition disposition,
            String channel,
            RecoveryStatus status,
            BigDecimal listedValue,
            BigDecimal expectedRecovery,
            BigDecimal actualRecovered,
            BigDecimal fees,
            BigDecimal netRecovered,
            String notes,
            Instant createdAt,
            Instant listedAt,
            Instant soldAt,
            Instant settledAt) {
        public static RecoveryResponse from(RecoveryRecord record) {
            return new RecoveryResponse(
                    record.getId(),
                    record.getProductReturn().getId(),
                    record.getExecution().getId(),
                    record.getDisposition(),
                    record.getChannel(),
                    record.getStatus(),
                    record.getListedValue(),
                    record.getExpectedRecovery(),
                    record.getActualRecovered(),
                    record.getFees(),
                    record.getNetRecovered(),
                    record.getNotes(),
                    record.getCreatedAt(),
                    record.getListedAt(),
                    record.getSoldAt(),
                    record.getSettledAt());
        }
    }

    @Schema(description = "Opens a resale/liquidation recovery (PENDING). One record per execution.")
    public record CreateRecoveryRequest(
            @NotBlank @Size(max = 255) String channel,
            @DecimalMin(value = "0.0", inclusive = true) BigDecimal listedValue,
            @DecimalMin(value = "0.0", inclusive = true) BigDecimal expectedRecovery,
            @Size(max = 2000) String notes) {}

    @Schema(description = "Records the sale: actual money in, fees out.")
    public record SellRecoveryRequest(
            @NotNull @DecimalMin(value = "0.0", inclusive = true) BigDecimal actualRecovered,
            @DecimalMin(value = "0.0", inclusive = true) BigDecimal fees,
            @Size(max = 2000) String notes) {}

    public record FailRecoveryRequest(@NotBlank @Size(min = 3, max = 1000) String reason) {}

    @Schema(description = "Admin correction of settled figures. Reason is mandatory and audited.")
    public record CorrectRecoveryRequest(
            @DecimalMin(value = "0.0", inclusive = true) BigDecimal actualRecovered,
            @DecimalMin(value = "0.0", inclusive = true) BigDecimal fees,
            @NotBlank @Size(min = 3, max = 1000) String reason) {}
}
