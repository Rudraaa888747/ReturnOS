package com.returnos.risk;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Pure deterministic engine: runs every rule over the context, sums the
 * contributions (clamped to 0-100) and maps the total to a risk level.
 * Contains no I/O, so it is trivially unit-testable.
 */
@Component
public class RiskAssessmentEngine {

    private final List<RiskRule> rules;
    private final RiskEngineProperties properties;

    public RiskAssessmentEngine(List<RiskRule> rules, RiskEngineProperties properties) {
        this.rules = rules;
        this.properties = properties;
    }

    public RiskResult assess(RiskAssessmentContext context) {
        List<RuleContribution> contributions = new ArrayList<>();
        for (RiskRule rule : rules) {
            contributions.addAll(rule.evaluateAll(context));
        }
        int total = contributions.stream().mapToInt(RuleContribution::points).sum();
        int score = Math.min(100, Math.max(0, total));
        RiskLevel level = score >= properties.getHighThreshold()
                ? RiskLevel.HIGH
                : score >= properties.getMediumThreshold() ? RiskLevel.MEDIUM : RiskLevel.LOW;
        return new RiskResult(score, level, contributions, Instant.now());
    }
}
