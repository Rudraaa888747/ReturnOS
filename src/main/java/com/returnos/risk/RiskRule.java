package com.returnos.risk;

import java.util.Optional;

/**
 * One deterministic risk signal. Implementations inspect the assessment context
 * (built only from ReturnOS data) and return a contribution when the signal
 * fires, or empty when it does not apply.
 */
public interface RiskRule {

    String code();

    Optional<RuleContribution> evaluate(RiskAssessmentContext context);

    /** Most rules contribute at most once; multi-contribution rules override this. */
    default java.util.List<RuleContribution> evaluateAll(RiskAssessmentContext context) {
        return evaluate(context).stream().toList();
    }
}
