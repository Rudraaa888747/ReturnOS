package com.returnos.risk;

import java.util.Optional;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/** Fires when the customer submitted several returns inside the recent window. */
@Component
@Order(1)
public class RecentReturnsRule implements RiskRule {

    private final RiskEngineProperties properties;

    public RecentReturnsRule(RiskEngineProperties properties) {
        this.properties = properties;
    }

    @Override
    public String code() {
        return "HIGH_RETURN_FREQUENCY";
    }

    @Override
    public Optional<RuleContribution> evaluate(RiskAssessmentContext context) {
        if (context.recentReturnCount() <= 0) {
            return Optional.empty();
        }
        int points = Math.min(
                context.recentReturnCount() * properties.getPointsPerRecentReturn(),
                properties.getMaxRecentPoints());
        return Optional.of(new RuleContribution(
                code(),
                points,
                "Customer has submitted " + context.recentReturnCount()
                        + " previous return(s) within the last " + properties.getRecentWindowDays() + " days."));
    }
}
