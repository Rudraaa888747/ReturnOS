package com.returnos.risk;

import java.util.Optional;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/** Fires when the customer already returned the same product before. */
@Component
@Order(5)
public class RepeatProductRule implements RiskRule {

    private final RiskEngineProperties properties;

    public RepeatProductRule(RiskEngineProperties properties) {
        this.properties = properties;
    }

    @Override
    public String code() {
        return "REPEAT_PRODUCT_RETURN";
    }

    @Override
    public Optional<RuleContribution> evaluate(RiskAssessmentContext context) {
        if (!context.repeatProduct()) {
            return Optional.empty();
        }
        return Optional.of(new RuleContribution(
                code(),
                properties.getRepeatProductPoints(),
                "Customer has previously returned the same product."));
    }
}
