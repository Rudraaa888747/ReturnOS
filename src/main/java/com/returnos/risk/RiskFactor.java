package com.returnos.risk;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.util.UUID;

@Entity
@Table(name = "risk_factors")
public class RiskFactor {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "assessment_id", nullable = false)
    private RiskAssessment assessment;

    @Column(name = "rule_code", nullable = false, length = 64)
    private String ruleCode;

    @Column(nullable = false)
    private int points;

    @Column(length = 1000)
    private String explanation;

    protected RiskFactor() {}

    public RiskFactor(String ruleCode, int points, String explanation) {
        this.id = UUID.randomUUID();
        this.ruleCode = ruleCode;
        this.points = points;
        this.explanation = explanation;
    }

    @PrePersist
    void prePersist() {
        if (id == null) id = UUID.randomUUID();
    }

    public UUID getId() { return id; }
    public RiskAssessment getAssessment() { return assessment; }
    public String getRuleCode() { return ruleCode; }
    public int getPoints() { return points; }
    public String getExplanation() { return explanation; }

    void setAssessment(RiskAssessment assessment) { this.assessment = assessment; }
}
