package com.returnos.risk;

import java.time.Instant;
import java.util.List;

/** Deterministic outcome of the risk engine: score, level and why. */
public record RiskResult(int score, RiskLevel level, List<RuleContribution> contributions, Instant assessedAt) {

    public RiskResult {
        contributions = contributions != null ? List.copyOf(contributions) : List.of();
    }
}
