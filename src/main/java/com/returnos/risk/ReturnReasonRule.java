package com.returnos.risk;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/**
 * Certain return reasons historically correlate with lower recovery (e.g.
 * change-of-mind items that cannot go back to the vendor). Points come from
 * configuration; reasons without configured points contribute nothing.
 */
@Component
@Order(4)
public class ReturnReasonRule implements RiskRule {

    private final RiskEngineProperties properties;

    public ReturnReasonRule(RiskEngineProperties properties) {
        this.properties = properties;
    }

    @Override
    public String code() {
        return "RETURN_REASON";
    }

    /** One contribution per distinct configured reason (engine merges the list). */
    @Override
    public List<RuleContribution> evaluateAll(RiskAssessmentContext context) {
        List<RuleContribution> contributions = new ArrayList<>();
        context.reasons().stream()
                .distinct()
                .forEach(reason -> {
                    int points = properties.getReasonPoints().getOrDefault(reason.name(), 0);
                    if (points > 0) {
                        contributions.add(new RuleContribution(
                                "REASON_" + reason.name(),
                                points,
                                "Return reason " + reason.name() + " is associated with higher handling attention."));
                    }
                });
        return contributions;
    }

    @Override
    public Optional<RuleContribution> evaluate(RiskAssessmentContext context) {
        // The engine prefers evaluateAll for this rule; single-evaluate is unsupported.
        return Optional.empty();
    }
}
