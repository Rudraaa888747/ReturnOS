package com.returnos.risk;

/**
 * Score contribution of a single risk rule, with a human-readable explanation
 * so every assessment is auditable.
 */
public record RuleContribution(String ruleCode, int points, String explanation) {}
