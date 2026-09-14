package com.returnos.risk;

import static org.assertj.core.api.Assertions.assertThat;

import com.returnos.returns.ReturnReason;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class RiskEngineTest {

    private RiskEngineProperties properties;
    private RiskAssessmentEngine engine;

    @BeforeEach
    void setUp() {
        properties = new RiskEngineProperties();
        List<RiskRule> rules = List.of(
                new RecentReturnsRule(properties),
                new LifetimeReturnsRule(properties),
                new HighValueRule(properties),
                new ReturnReasonRule(properties),
                new RepeatProductRule(properties),
                new MultiItemRule(properties));
        engine = new RiskAssessmentEngine(rules, properties);
    }

    private RiskAssessmentContext context(
            int recent, int lifetime, String value, List<ReturnReason> reasons,
            boolean repeat, int items) {
        return new RiskAssessmentContext(
                UUID.randomUUID(), UUID.randomUUID(), recent, lifetime,
                new BigDecimal(value), reasons, repeat, items);
    }

    @Test
    void emptyContextIsLowWithNoContributions() {
        RiskResult result = engine.assess(context(0, 0, "0", List.of(), false, 1));

        assertThat(result.score()).isZero();
        assertThat(result.level()).isEqualTo(RiskLevel.LOW);
        assertThat(result.contributions()).isEmpty();
        assertThat(result.assessedAt()).isNotNull();
    }

    @Test
    void mediumRiskCalculation() {
        // 3 recent * 8 = 24 + lifetime tier1 (3 history) 5 + CHANGED_MIND 5 = 34
        RiskResult result =
                engine.assess(context(3, 3, "100.00", List.of(ReturnReason.CHANGED_MIND), false, 1));

        assertThat(result.score()).isEqualTo(34);
        assertThat(result.level()).isEqualTo(RiskLevel.MEDIUM);
        assertThat(result.contributions()).extracting(RuleContribution::ruleCode)
                .contains("HIGH_RETURN_FREQUENCY", "HIGH_LIFETIME_RETURNS", "REASON_CHANGED_MIND");
    }

    @Test
    void highRiskCalculation() {
        // recent cap 32 + lifetime tier2 10 + high value 10 + repeat 12 + multi 6 + OTHER 5 = 75
        RiskResult result = engine.assess(
                context(9, 9, "6000.00", List.of(ReturnReason.OTHER), true, 3));

        assertThat(result.score()).isEqualTo(75);
        assertThat(result.level()).isEqualTo(RiskLevel.HIGH);
        assertThat(result.contributions()).hasSize(6);
    }

    @Test
    void boundary29IsLow() {
        // 3 recent * 8 = 24 + OTHER 5 = 29
        RiskResult result = engine.assess(context(3, 0, "0", List.of(ReturnReason.OTHER), false, 1));

        assertThat(result.score()).isEqualTo(29);
        assertThat(result.level()).isEqualTo(RiskLevel.LOW);
    }

    @Test
    void boundary30IsMedium() {
        // 3 recent * 8 = 24 + multi-item 6 = 30
        RiskResult result = engine.assess(context(3, 0, "0", List.of(), false, 2));

        assertThat(result.score()).isEqualTo(30);
        assertThat(result.level()).isEqualTo(RiskLevel.MEDIUM);
    }

    @Test
    void justBelowHighIsMedium() {
        // recent cap 32 (4+ recent) + lifetime tier2 10 + high value 10 + CHANGED_MIND 5 = 57
        RiskResult result =
                engine.assess(context(4, 6, "6000.00", List.of(ReturnReason.CHANGED_MIND), false, 1));

        assertThat(result.score()).isEqualTo(57);
        assertThat(result.level()).isEqualTo(RiskLevel.MEDIUM);
    }

    @Test
    void boundary60IsHigh() {
        // 32 + 10 + 12 + 6 = 60
        RiskResult result = engine.assess(context(4, 6, "0", List.of(), true, 2));

        assertThat(result.score()).isEqualTo(60);
        assertThat(result.level()).isEqualTo(RiskLevel.HIGH);
    }

    @Test
    void scoreClampedAt100() {
        properties.setPointsPerRecentReturn(100);
        properties.setMaxRecentPoints(500);

        RiskResult result = engine.assess(context(5, 0, "0", List.of(), false, 1));

        assertThat(result.score()).isEqualTo(100);
        assertThat(result.level()).isEqualTo(RiskLevel.HIGH);
    }

    @Test
    void unconfiguredReasonsContributeNothing() {
        RiskResult result =
                engine.assess(context(0, 0, "0", List.of(ReturnReason.DEFECTIVE, ReturnReason.DAMAGED), false, 1));

        assertThat(result.score()).isZero();
        assertThat(result.contributions()).isEmpty();
    }

    @Test
    void missingOptionalDataIsHandled() {
        RiskAssessmentContext ctx = new RiskAssessmentContext(
                UUID.randomUUID(), UUID.randomUUID(), 0, 0, null, null, false, 1);

        RiskResult result = engine.assess(ctx);

        assertThat(result.score()).isZero();
        assertThat(result.level()).isEqualTo(RiskLevel.LOW);
    }

    @Test
    void explanationsAreHumanReadable() {
        RiskResult result = engine.assess(context(2, 0, "0", List.of(), true, 1));

        assertThat(result.contributions())
                .allSatisfy(c -> assertThat(c.explanation()).isNotBlank().contains("Customer"));
    }
}
