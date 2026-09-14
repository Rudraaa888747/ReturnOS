package com.returnos.returns;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

public enum ReturnStatus {
    REQUESTED,
    APPROVED,
    REJECTED,
    IN_TRANSIT,
    RECEIVED,
    INSPECTION_PENDING,
    INSPECTION_IN_PROGRESS,
    INSPECTION_COMPLETED;

    private static final Map<ReturnStatus, Set<ReturnStatus>> ALLOWED = new EnumMap<>(ReturnStatus.class);

    static {
        ALLOWED.put(REQUESTED, EnumSet.of(APPROVED, REJECTED));
        ALLOWED.put(APPROVED, EnumSet.of(IN_TRANSIT, RECEIVED));
        ALLOWED.put(IN_TRANSIT, EnumSet.of(RECEIVED));
        ALLOWED.put(RECEIVED, EnumSet.of(INSPECTION_PENDING, INSPECTION_IN_PROGRESS));
        ALLOWED.put(INSPECTION_PENDING, EnumSet.of(INSPECTION_IN_PROGRESS, INSPECTION_COMPLETED));
        ALLOWED.put(INSPECTION_IN_PROGRESS, EnumSet.of(INSPECTION_COMPLETED));
        ALLOWED.put(REJECTED, EnumSet.noneOf(ReturnStatus.class));
        ALLOWED.put(INSPECTION_COMPLETED, EnumSet.noneOf(ReturnStatus.class));
    }

    public boolean canTransitionTo(ReturnStatus target) {
        return ALLOWED.getOrDefault(this, Set.of()).contains(target);
    }

    public boolean isTerminal() {
        return this == REJECTED || this == INSPECTION_COMPLETED;
    }
}
