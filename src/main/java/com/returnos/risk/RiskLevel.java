package com.returnos.risk;

/**
 * Operational attention level for a return. This is NOT a fraud accusation -
 * it only expresses how much handling attention / recovery uncertainty the
 * return carries, based on deterministic rules over ReturnOS data.
 */
public enum RiskLevel {
    LOW,
    MEDIUM,
    HIGH
}
