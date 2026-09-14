package com.returnos.disposition;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class DispositionDtos {

    private DispositionDtos() {}

    public record CandidateResponse(
            Disposition disposition,
            boolean eligible,
            BigDecimal recoveryValue,
            BigDecimal processingCost,
            BigDecimal shippingCost,
            BigDecimal refurbishmentCost,
            BigDecimal netRecovery,
            String reason) {
        public static CandidateResponse from(EvaluationCandidate candidate) {
            return new CandidateResponse(
                    candidate.getDisposition(),
                    candidate.isEligible(),
                    candidate.getRecoveryValue(),
                    candidate.getProcessingCost(),
                    candidate.getShippingCost(),
                    candidate.getRefurbishmentCost(),
                    candidate.getNetRecovery(),
                    candidate.getReason());
        }

        public static CandidateResponse from(DispositionCandidate candidate) {
            return new CandidateResponse(
                    candidate.disposition(),
                    candidate.eligible(),
                    candidate.recoveryValue(),
                    candidate.processingCost(),
                    candidate.shippingCost(),
                    candidate.refurbishmentCost(),
                    candidate.netRecovery(),
                    candidate.reason());
        }
    }

    public record EvaluationResponse(
            UUID id,
            UUID returnId,
            Disposition recommended,
            List<CandidateResponse> candidates,
            UUID evaluatedBy,
            Instant evaluatedAt,
            Disposition finalDisposition,
            UUID finalizedBy,
            Instant finalizedAt,
            boolean overridden,
            String overrideReason) {
        public static EvaluationResponse from(DispositionEvaluation evaluation) {
            return new EvaluationResponse(
                    evaluation.getId(),
                    evaluation.getProductReturn().getId(),
                    evaluation.getRecommended(),
                    evaluation.getCandidates().stream().map(CandidateResponse::from).toList(),
                    evaluation.getEvaluatedBy() != null ? evaluation.getEvaluatedBy().getId() : null,
                    evaluation.getEvaluatedAt(),
                    evaluation.getFinalDisposition(),
                    evaluation.getFinalizedBy() != null ? evaluation.getFinalizedBy().getId() : null,
                    evaluation.getFinalizedAt(),
                    evaluation.isOverridden(),
                    evaluation.getOverrideReason());
        }
    }

    @Schema(description = "Records the final disposition. Omit disposition to accept the recommendation.")
    public record FinalizeRequest(
            @Schema(description = "Final channel. Defaults to the system recommendation when omitted.") Disposition disposition,
            @Schema(description = "Required when the final channel differs from the recommendation.") String overrideReason) {}

    @Schema(description = "Explicit admin override of the system recommendation.")
    public record OverrideRequest(
            @NotNull Disposition disposition,
            @NotBlank @Size(min = 3, max = 1000) String reason) {}
}
