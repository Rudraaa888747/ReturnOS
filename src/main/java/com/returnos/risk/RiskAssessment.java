package com.returnos.risk;

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
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "risk_assessments")
public class RiskAssessment {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "return_id", nullable = false, unique = true)
    private Return productReturn;

    @Column(nullable = false)
    private int score;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private RiskLevel level;

    @OneToMany(mappedBy = "assessment", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<RiskFactor> factors = new ArrayList<>();

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "assessed_by")
    private User assessedBy;

    @Column(name = "assessed_at", nullable = false)
    private Instant assessedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Version
    private long version;

    protected RiskAssessment() {}

    public RiskAssessment(Return productReturn, int score, RiskLevel level, User assessedBy, Instant assessedAt) {
        this.id = UUID.randomUUID();
        this.productReturn = productReturn;
        this.score = score;
        this.level = level;
        this.assessedBy = assessedBy;
        this.assessedAt = assessedAt;
        this.createdAt = Instant.now();
    }

    @PrePersist
    void prePersist() {
        if (id == null) id = UUID.randomUUID();
        if (createdAt == null) createdAt = Instant.now();
        if (assessedAt == null) assessedAt = Instant.now();
    }

    public void addFactor(RiskFactor factor) {
        factors.add(factor);
        factor.setAssessment(this);
    }

    public UUID getId() { return id; }
    public Return getProductReturn() { return productReturn; }
    public int getScore() { return score; }
    public RiskLevel getLevel() { return level; }
    public List<RiskFactor> getFactors() { return factors; }
    public User getAssessedBy() { return assessedBy; }
    public Instant getAssessedAt() { return assessedAt; }
    public Instant getCreatedAt() { return createdAt; }
}
