package com.returnos.task;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

public enum TaskStatus {
    OPEN,
    IN_PROGRESS,
    COMPLETED,
    CANCELLED;

    private static final Map<TaskStatus, Set<TaskStatus>> ALLOWED = new EnumMap<>(TaskStatus.class);

    static {
        ALLOWED.put(OPEN, EnumSet.of(IN_PROGRESS, CANCELLED));
        ALLOWED.put(IN_PROGRESS, EnumSet.of(COMPLETED, CANCELLED));
        ALLOWED.put(COMPLETED, EnumSet.noneOf(TaskStatus.class));
        ALLOWED.put(CANCELLED, EnumSet.noneOf(TaskStatus.class));
    }

    public boolean canTransitionTo(TaskStatus target) {
        return ALLOWED.getOrDefault(this, Set.of()).contains(target);
    }
}
