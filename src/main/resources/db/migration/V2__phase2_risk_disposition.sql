-- ReturnOS Phase 2: risk assessments + disposition evaluations.
-- Additive only; Phase-1 tables are untouched.

-- ============ RISK ASSESSMENTS ============
CREATE TABLE risk_assessments (
    id UUID PRIMARY KEY,
    return_id UUID NOT NULL UNIQUE REFERENCES returns(id) ON DELETE CASCADE,
    score INT NOT NULL,
    level VARCHAR(16) NOT NULL,
    assessed_by UUID REFERENCES app_users(id),
    assessed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT chk_risk_assessments_score CHECK (score >= 0 AND score <= 100),
    CONSTRAINT chk_risk_assessments_level CHECK (level IN ('LOW', 'MEDIUM', 'HIGH'))
);
CREATE INDEX idx_risk_assessments_return ON risk_assessments(return_id);

CREATE TABLE risk_factors (
    id UUID PRIMARY KEY,
    assessment_id UUID NOT NULL REFERENCES risk_assessments(id) ON DELETE CASCADE,
    rule_code VARCHAR(64) NOT NULL,
    points INT NOT NULL,
    explanation VARCHAR(1000),
    CONSTRAINT chk_risk_factors_points CHECK (points >= 0)
);
CREATE INDEX idx_risk_factors_assessment ON risk_factors(assessment_id);

-- ============ DISPOSITION EVALUATIONS ============
CREATE TABLE disposition_evaluations (
    id UUID PRIMARY KEY,
    return_id UUID NOT NULL UNIQUE REFERENCES returns(id) ON DELETE CASCADE,
    recommended VARCHAR(32) NOT NULL,
    evaluated_by UUID REFERENCES app_users(id),
    evaluated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    final_disposition VARCHAR(32),
    finalized_by UUID REFERENCES app_users(id),
    finalized_at TIMESTAMP WITH TIME ZONE,
    overridden BOOLEAN NOT NULL DEFAULT FALSE,
    override_reason VARCHAR(1000),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT chk_disposition_recommended CHECK (recommended IN (
        'RESTOCK', 'REFURBISH', 'RESELL', 'RETURN_TO_VENDOR', 'LIQUIDATE', 'RECYCLE', 'SCRAP'
    )),
    CONSTRAINT chk_disposition_final CHECK (final_disposition IS NULL OR final_disposition IN (
        'RESTOCK', 'REFURBISH', 'RESELL', 'RETURN_TO_VENDOR', 'LIQUIDATE', 'RECYCLE', 'SCRAP'
    ))
);
CREATE INDEX idx_disposition_evaluations_return ON disposition_evaluations(return_id);

CREATE TABLE disposition_candidates (
    id UUID PRIMARY KEY,
    evaluation_id UUID NOT NULL REFERENCES disposition_evaluations(id) ON DELETE CASCADE,
    disposition VARCHAR(32) NOT NULL,
    eligible BOOLEAN NOT NULL,
    recovery_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
    processing_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
    shipping_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
    refurbishment_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
    net_recovery NUMERIC(12, 2) NOT NULL DEFAULT 0,
    reason VARCHAR(1000),
    CONSTRAINT chk_disposition_candidate CHECK (disposition IN (
        'RESTOCK', 'REFURBISH', 'RESELL', 'RETURN_TO_VENDOR', 'LIQUIDATE', 'RECYCLE', 'SCRAP'
    ))
);
CREATE INDEX idx_disposition_candidates_evaluation ON disposition_candidates(evaluation_id);
