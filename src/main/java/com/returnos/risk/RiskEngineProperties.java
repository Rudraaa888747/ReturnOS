package com.returnos.risk;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Tunables for the rule-based risk engine. Weights and thresholds live here,
 * not scattered across rule classes, so behavior changes without code changes.
 */
@ConfigurationProperties(prefix = "returnos.risk")
public class RiskEngineProperties {

    private int recentWindowDays = 30;
    private int pointsPerRecentReturn = 8;
    private int maxRecentPoints = 32;
    private int lifetimeTier1Count = 3;
    private int lifetimeTier1Points = 5;
    private int lifetimeTier2Count = 6;
    private int lifetimeTier2Points = 10;
    private BigDecimal highValueThreshold = new BigDecimal("5000");
    private int highValuePoints = 10;
    private int repeatProductPoints = 12;
    private int multiItemThreshold = 2;
    private int multiItemPoints = 6;
    private int mediumThreshold = 30;
    private int highThreshold = 60;
    private Map<String, Integer> reasonPoints = new HashMap<>(Map.of(
            "WRONG_ITEM", 2,
            "WRONG_SIZE", 2,
            "MISSING_PARTS", 2,
            "NOT_AS_DESCRIBED", 4,
            "CHANGED_MIND", 5,
            "OTHER", 5));

    public int getRecentWindowDays() { return recentWindowDays; }
    public void setRecentWindowDays(int recentWindowDays) { this.recentWindowDays = recentWindowDays; }

    public int getPointsPerRecentReturn() { return pointsPerRecentReturn; }
    public void setPointsPerRecentReturn(int pointsPerRecentReturn) { this.pointsPerRecentReturn = pointsPerRecentReturn; }

    public int getMaxRecentPoints() { return maxRecentPoints; }
    public void setMaxRecentPoints(int maxRecentPoints) { this.maxRecentPoints = maxRecentPoints; }

    public int getLifetimeTier1Count() { return lifetimeTier1Count; }
    public void setLifetimeTier1Count(int lifetimeTier1Count) { this.lifetimeTier1Count = lifetimeTier1Count; }

    public int getLifetimeTier1Points() { return lifetimeTier1Points; }
    public void setLifetimeTier1Points(int lifetimeTier1Points) { this.lifetimeTier1Points = lifetimeTier1Points; }

    public int getLifetimeTier2Count() { return lifetimeTier2Count; }
    public void setLifetimeTier2Count(int lifetimeTier2Count) { this.lifetimeTier2Count = lifetimeTier2Count; }

    public int getLifetimeTier2Points() { return lifetimeTier2Points; }
    public void setLifetimeTier2Points(int lifetimeTier2Points) { this.lifetimeTier2Points = lifetimeTier2Points; }

    public BigDecimal getHighValueThreshold() { return highValueThreshold; }
    public void setHighValueThreshold(BigDecimal highValueThreshold) { this.highValueThreshold = highValueThreshold; }

    public int getHighValuePoints() { return highValuePoints; }
    public void setHighValuePoints(int highValuePoints) { this.highValuePoints = highValuePoints; }

    public int getRepeatProductPoints() { return repeatProductPoints; }
    public void setRepeatProductPoints(int repeatProductPoints) { this.repeatProductPoints = repeatProductPoints; }

    public int getMultiItemThreshold() { return multiItemThreshold; }
    public void setMultiItemThreshold(int multiItemThreshold) { this.multiItemThreshold = multiItemThreshold; }

    public int getMultiItemPoints() { return multiItemPoints; }
    public void setMultiItemPoints(int multiItemPoints) { this.multiItemPoints = multiItemPoints; }

    public int getMediumThreshold() { return mediumThreshold; }
    public void setMediumThreshold(int mediumThreshold) { this.mediumThreshold = mediumThreshold; }

    public int getHighThreshold() { return highThreshold; }
    public void setHighThreshold(int highThreshold) { this.highThreshold = highThreshold; }

    public Map<String, Integer> getReasonPoints() { return reasonPoints; }
    public void setReasonPoints(Map<String, Integer> reasonPoints) {
        this.reasonPoints = reasonPoints != null ? reasonPoints : new HashMap<>();
    }
}
