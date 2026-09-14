package com.returnos.recovery;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

public enum RecoveryStatus {
    PENDING,
    LISTED,
    SOLD,
    SETTLED,
    FAILED;

    private static final Map<RecoveryStatus, Set<RecoveryStatus>> ALLOWED = new EnumMap<>(RecoveryStatus.class);

    static {
        ALLOWED.put(PENDING, EnumSet.of(LISTED, FAILED));
        ALLOWED.put(LISTED, EnumSet.of(SOLD, FAILED));
        ALLOWED.put(SOLD, EnumSet.of(SETTLED, FAILED));
        ALLOWED.put(SETTLED, EnumSet.noneOf(RecoveryStatus.class));
        ALLOWED.put(FAILED, EnumSet.noneOf(RecoveryStatus.class));
    }

    public boolean canTransitionTo(RecoveryStatus target) {
        return ALLOWED.getOrDefault(this, Set.of()).contains(target);
    }
}
