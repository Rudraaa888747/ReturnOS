package com.returnos.risk;

import java.util.Optional;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/** Multi-item returns need more inspection effort and usually recover less. */
@Component
@Order(6)
public class MultiItemRule implements RiskRule {

    private final RiskEngineProperties properties;

    public MultiItemRule(RiskEngineProperties properties) {
        this.properties = properties;
    }

    @Override
    public String code() {
        return "MULTI_ITEM_RETURN";
    }

    @Override
    public Optional<RuleContribution> evaluate(RiskAssessmentContext context) {
        if (context.distinctItemCount() < properties.getMultiItemThreshold()) {
            return Optional.empty();
        }
        return Optional.of(new RuleContribution(
                code(),
                properties.getMultiItemPoints(),
                "Return contains " + context.distinctItemCount() + " distinct items."));
    }
}
