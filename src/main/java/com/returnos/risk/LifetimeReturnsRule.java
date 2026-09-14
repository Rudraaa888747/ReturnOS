package com.returnos.risk;

import java.util.Optional;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/** Fires on tiered lifetime return counts for the customer. */
@Component
@Order(2)
public class LifetimeReturnsRule implements RiskRule {

    private final RiskEngineProperties properties;

    public LifetimeReturnsRule(RiskEngineProperties properties) {
        this.properties = properties;
    }

    @Override
    public String code() {
        return "HIGH_LIFETIME_RETURNS";
    }

    @Override
    public Optional<RuleContribution> evaluate(RiskAssessmentContext context) {
        int lifetime = context.lifetimeReturnCount();
        if (lifetime >= properties.getLifetimeTier2Count()) {
            return Optional.of(new RuleContribution(
                    code(),
                    properties.getLifetimeTier2Points(),
                    "Customer has a history of " + lifetime + " previous returns."));
        }
        if (lifetime >= properties.getLifetimeTier1Count()) {
            return Optional.of(new RuleContribution(
                    code(),
                    properties.getLifetimeTier1Points(),
                    "Customer has a history of " + lifetime + " previous returns."));
        }
        return Optional.empty();
    }
}
