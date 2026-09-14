package com.returnos.disposition;

import com.returnos.returns.Return;
import com.returnos.user.User;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OneToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "disposition_evaluations")
public class DispositionEvaluation {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "return_id", nullable = false, unique = true)
    private Return productReturn;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private Disposition recommended;

    @OneToMany(mappedBy = "evaluation", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<EvaluationCandidate> candidates = new ArrayList<>();

    @Enumerated(EnumType.STRING)
    @Column(name = "final_disposition", length = 32)
    private Disposition finalDisposition;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "evaluated_by")
    private User evaluatedBy;

    @Column(name = "evaluated_at", nullable = false)
    private Instant evaluatedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "finalized_by")
    private User finalizedBy;

    @Column(name = "finalized_at")
    private Instant finalizedAt;

    @Column(nullable = false)
    private boolean overridden = false;

    @Column(name = "override_reason", length = 1000)
    private String overrideReason;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    private long version;

    protected DispositionEvaluation() {}

    public DispositionEvaluation(Return productReturn, Disposition recommended, User evaluatedBy, Instant evaluatedAt) {
        this.id = UUID.randomUUID();
        this.productReturn = productReturn;
        this.recommended = recommended;
        this.evaluatedBy = evaluatedBy;
        this.evaluatedAt = evaluatedAt;
        this.createdAt = Instant.now();
        this.updatedAt = Instant.now();
    }

    @PrePersist
    void prePersist() {
        if (id == null) id = UUID.randomUUID();
        if (createdAt == null) createdAt = Instant.now();
        if (evaluatedAt == null) evaluatedAt = Instant.now();
        updatedAt = Instant.now();
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }

    public void addCandidate(EvaluationCandidate candidate) {
        candidates.add(candidate);
        candidate.setEvaluation(this);
    }

    public UUID getId() { return id; }
    public Return getProductReturn() { return productReturn; }
    public Disposition getRecommended() { return recommended; }
    public List<EvaluationCandidate> getCandidates() { return candidates; }
    public Disposition getFinalDisposition() { return finalDisposition; }
    public User getEvaluatedBy() { return evaluatedBy; }
    public Instant getEvaluatedAt() { return evaluatedAt; }
    public User getFinalizedBy() { return finalizedBy; }
    public Instant getFinalizedAt() { return finalizedAt; }
    public boolean isOverridden() { return overridden; }
    public String getOverrideReason() { return overrideReason; }
    public Instant getCreatedAt() { return createdAt; }

    public void setFinalDisposition(Disposition finalDisposition) { this.finalDisposition = finalDisposition; }
    public void setFinalizedBy(User finalizedBy) { this.finalizedBy = finalizedBy; }
    public void setFinalizedAt(Instant finalizedAt) { this.finalizedAt = finalizedAt; }
    public void setOverridden(boolean overridden) { this.overridden = overridden; }
    public void setOverrideReason(String overrideReason) { this.overrideReason = overrideReason; }
}
