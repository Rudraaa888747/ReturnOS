package com.returnos.inspection;

import com.returnos.returns.Return;
import com.returnos.user.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "inspections")
public class Inspection {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "return_id", nullable = false, unique = true)
    private Return productReturn;

    @Enumerated(EnumType.STRING)
    @Column(name = "physical_condition", nullable = false, length = 32)
    private PhysicalCondition physicalCondition;

    @Enumerated(EnumType.STRING)
    @Column(name = "packaging_condition", nullable = false, length = 32)
    private PackagingCondition packagingCondition;

    @Column(name = "accessories_complete", nullable = false)
    private boolean accessoriesComplete;

    @Enumerated(EnumType.STRING)
    @Column(name = "functional_test_result", nullable = false, length = 32)
    private FunctionalTestResult functionalTestResult;

    @Column(name = "visible_damage", length = 1000)
    private String visibleDamage;

    @Column(length = 2000)
    private String notes;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "inspected_by")
    private User inspectedBy;

    @Column(name = "inspected_at", nullable = false)
    private Instant inspectedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    private long version;

    protected Inspection() {}

    public Inspection(
            Return productReturn,
            PhysicalCondition physicalCondition,
            PackagingCondition packagingCondition,
            boolean accessoriesComplete,
            FunctionalTestResult functionalTestResult,
            String visibleDamage,
            String notes,
            User inspectedBy) {
        this.id = UUID.randomUUID();
        this.productReturn = productReturn;
        this.physicalCondition = physicalCondition;
        this.packagingCondition = packagingCondition;
        this.accessoriesComplete = accessoriesComplete;
        this.functionalTestResult = functionalTestResult;
        this.visibleDamage = visibleDamage;
        this.notes = notes;
        this.inspectedBy = inspectedBy;
        this.inspectedAt = Instant.now();
        this.createdAt = Instant.now();
        this.updatedAt = Instant.now();
    }

    @PrePersist
    void prePersist() {
        if (id == null) id = UUID.randomUUID();
        if (createdAt == null) createdAt = Instant.now();
        if (inspectedAt == null) inspectedAt = Instant.now();
        updatedAt = Instant.now();
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }

    public UUID getId() { return id; }
    public Return getProductReturn() { return productReturn; }
    public PhysicalCondition getPhysicalCondition() { return physicalCondition; }
    public PackagingCondition getPackagingCondition() { return packagingCondition; }
    public boolean isAccessoriesComplete() { return accessoriesComplete; }
    public FunctionalTestResult getFunctionalTestResult() { return functionalTestResult; }
    public String getVisibleDamage() { return visibleDamage; }
    public String getNotes() { return notes; }
    public User getInspectedBy() { return inspectedBy; }
    public Instant getInspectedAt() { return inspectedAt; }
    public Instant getCreatedAt() { return createdAt; }
}
