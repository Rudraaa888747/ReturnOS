package com.returnos.execution;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/** Operational lifecycle of a finalized disposition. */
public enum ExecutionStatus {
    PENDING,
    IN_PROGRESS,
    COMPLETED,
    FAILED;

    private static final Map<ExecutionStatus, Set<ExecutionStatus>> ALLOWED = new EnumMap<>(ExecutionStatus.class);

    static {
        ALLOWED.put(PENDING, EnumSet.of(IN_PROGRESS));
        ALLOWED.put(IN_PROGRESS, EnumSet.of(COMPLETED, FAILED));
        ALLOWED.put(COMPLETED, EnumSet.noneOf(ExecutionStatus.class));
        ALLOWED.put(FAILED, EnumSet.noneOf(ExecutionStatus.class));
    }

    public boolean canTransitionTo(ExecutionStatus target) {
        return ALLOWED.getOrDefault(this, Set.of()).contains(target);
    }
}
