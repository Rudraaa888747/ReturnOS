package com.returnos.disposition;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Table(name = "disposition_candidates")
public class EvaluationCandidate {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "evaluation_id", nullable = false)
    private DispositionEvaluation evaluation;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private Disposition disposition;

    @Column(nullable = false)
    private boolean eligible;

    @Column(name = "recovery_value", nullable = false, precision = 12, scale = 2)
    private BigDecimal recoveryValue;

    @Column(name = "processing_cost", nullable = false, precision = 12, scale = 2)
    private BigDecimal processingCost;

    @Column(name = "shipping_cost", nullable = false, precision = 12, scale = 2)
    private BigDecimal shippingCost;

    @Column(name = "refurbishment_cost", nullable = false, precision = 12, scale = 2)
    private BigDecimal refurbishmentCost;

    @Column(name = "net_recovery", nullable = false, precision = 12, scale = 2)
    private BigDecimal netRecovery;

    @Column(length = 1000)
    private String reason;

    protected EvaluationCandidate() {}

    public EvaluationCandidate(
            Disposition disposition,
            boolean eligible,
            BigDecimal recoveryValue,
            BigDecimal processingCost,
            BigDecimal shippingCost,
            BigDecimal refurbishmentCost,
            BigDecimal netRecovery,
            String reason) {
        this.id = UUID.randomUUID();
        this.disposition = disposition;
        this.eligible = eligible;
        this.recoveryValue = recoveryValue;
        this.processingCost = processingCost;
        this.shippingCost = shippingCost;
        this.refurbishmentCost = refurbishmentCost;
        this.netRecovery = netRecovery;
        this.reason = reason;
    }

    @PrePersist
    void prePersist() {
        if (id == null) id = UUID.randomUUID();
    }

    public UUID getId() { return id; }
    public DispositionEvaluation getEvaluation() { return evaluation; }
    public Disposition getDisposition() { return disposition; }
    public boolean isEligible() { return eligible; }
    public BigDecimal getRecoveryValue() { return recoveryValue; }
    public BigDecimal getProcessingCost() { return processingCost; }
    public BigDecimal getShippingCost() { return shippingCost; }
    public BigDecimal getRefurbishmentCost() { return refurbishmentCost; }
    public BigDecimal getNetRecovery() { return netRecovery; }
    public String getReason() { return reason; }

    void setEvaluation(DispositionEvaluation evaluation) { this.evaluation = evaluation; }
}
