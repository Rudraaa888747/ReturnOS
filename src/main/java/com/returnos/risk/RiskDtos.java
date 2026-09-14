package com.returnos.risk;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class RiskDtos {

    private RiskDtos() {}

    public record FactorResponse(String ruleCode, int points, String explanation) {
        public static FactorResponse from(RiskFactor factor) {
            return new FactorResponse(factor.getRuleCode(), factor.getPoints(), factor.getExplanation());
        }

        public static FactorResponse from(RuleContribution contribution) {
            return new FactorResponse(
                    contribution.ruleCode(), contribution.points(), contribution.explanation());
        }
    }

    public record RiskAssessmentResponse(
            UUID id,
            UUID returnId,
            int score,
            RiskLevel level,
            List<FactorResponse> factors,
            UUID assessedBy,
            Instant assessedAt) {
        public static RiskAssessmentResponse from(RiskAssessment assessment) {
            return new RiskAssessmentResponse(
                    assessment.getId(),
                    assessment.getProductReturn().getId(),
                    assessment.getScore(),
                    assessment.getLevel(),
                    assessment.getFactors().stream().map(FactorResponse::from).toList(),
                    assessment.getAssessedBy() != null ? assessment.getAssessedBy().getId() : null,
                    assessment.getAssessedAt());
        }
    }
}
