package com.returnos.policy;

public record EligibilityResult(boolean eligible, String reason) {
    public static EligibilityResult ok(String reason) {
        return new EligibilityResult(true, reason);
    }

    public static EligibilityResult fail(String reason) {
        return new EligibilityResult(false, reason);
    }
}
