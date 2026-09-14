package com.returnos.risk;

import java.util.Optional;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/** High order value increases the financial exposure of getting recovery wrong. */
@Component
@Order(3)
public class HighValueRule implements RiskRule {

    private final RiskEngineProperties properties;

    public HighValueRule(RiskEngineProperties properties) {
        this.properties = properties;
    }

    @Override
    public String code() {
        return "HIGH_ORDER_VALUE";
    }

    @Override
    public Optional<RuleContribution> evaluate(RiskAssessmentContext context) {
        if (context.orderValue().compareTo(properties.getHighValueThreshold()) < 0) {
            return Optional.empty();
        }
        return Optional.of(new RuleContribution(
                code(),
                properties.getHighValuePoints(),
                "Order value " + context.orderValue() + " reaches the high-value threshold "
                        + properties.getHighValueThreshold() + "."));
    }
}
