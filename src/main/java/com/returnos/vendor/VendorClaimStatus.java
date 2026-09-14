package com.returnos.vendor;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

public enum VendorClaimStatus {
    DRAFT,
    SUBMITTED,
    ACKNOWLEDGED,
    APPROVED,
    REJECTED,
    SETTLED;

    private static final Map<VendorClaimStatus, Set<VendorClaimStatus>> ALLOWED =
            new EnumMap<>(VendorClaimStatus.class);

    static {
        ALLOWED.put(DRAFT, EnumSet.of(SUBMITTED));
        ALLOWED.put(SUBMITTED, EnumSet.of(ACKNOWLEDGED, REJECTED));
        ALLOWED.put(ACKNOWLEDGED, EnumSet.of(APPROVED, REJECTED));
        ALLOWED.put(APPROVED, EnumSet.of(SETTLED));
        ALLOWED.put(REJECTED, EnumSet.noneOf(VendorClaimStatus.class));
        ALLOWED.put(SETTLED, EnumSet.noneOf(VendorClaimStatus.class));
    }

    public boolean canTransitionTo(VendorClaimStatus target) {
        return ALLOWED.getOrDefault(this, Set.of()).contains(target);
    }
}
