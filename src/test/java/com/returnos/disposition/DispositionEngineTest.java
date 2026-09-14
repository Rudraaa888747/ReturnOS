package com.returnos.disposition;

import static org.assertj.core.api.Assertions.assertThat;

import com.returnos.inspection.FunctionalTestResult;
import com.returnos.inspection.PackagingCondition;
import com.returnos.inspection.PhysicalCondition;
import com.returnos.returns.ReturnReason;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class DispositionEngineTest {

    private DispositionEngine engine;

    @BeforeEach
    void setUp() {
        engine = new DispositionEngine(new DispositionProperties(), new RecoveryCalculator());
    }

    private DispositionInput input(
            PhysicalCondition physical,
            PackagingCondition packaging,
            boolean accessories,
            FunctionalTestResult functional,
            String goodsValue,
            ReturnReason reason,
            Instant deliveredAt) {
        return new DispositionInput(
                physical, packaging, accessories, functional,
                new BigDecimal(goodsValue), reason, deliveredAt, Instant.now());
    }

    private Map<Disposition, DispositionCandidate> byDisposition(DispositionResult result) {
        return result.candidates().stream()
                .collect(Collectors.toMap(DispositionCandidate::disposition, Function.identity()));
    }

    @Test
    void cleanFunctionalItemGoesToRestock() {
        DispositionResult result = engine.evaluate(input(
                PhysicalCondition.EXCELLENT, PackagingCondition.SEALED, true,
                FunctionalTestResult.PASSED, "2000", ReturnReason.CHANGED_MIND,
                Instant.now().minus(5, ChronoUnit.DAYS)));

        assertThat(result.recommended()).isEqualTo(Disposition.RESTOCK);
        DispositionCandidate restock = byDisposition(result).get(Disposition.RESTOCK);
        assertThat(restock.eligible()).isTrue();
        // 2000 * 0.95 - 150 - 250 = 1500
        assertThat(restock.netRecovery()).isEqualByComparingTo(new BigDecimal("1500"));
        // Vendor channel correctly rejected: change-of-mind is not a vendor reason.
        assertThat(byDisposition(result).get(Disposition.RETURN_TO_VENDOR).eligible()).isFalse();
    }

    @Test
    void damagedPackagingWithFailedFunctionalGoesToRefurbish() {
        DispositionResult result = engine.evaluate(input(
                PhysicalCondition.FAIR, PackagingCondition.DAMAGED, true,
                FunctionalTestResult.FAILED, "2000", ReturnReason.CHANGED_MIND,
                Instant.now().minus(5, ChronoUnit.DAYS)));

        assertThat(result.recommended()).isEqualTo(Disposition.REFURBISH);
        // 2000 * 0.80 - 150 - 250 - 600 = 600 beats liquidation 2000 * 0.35 - 400 = 300
        assertThat(byDisposition(result).get(Disposition.REFURBISH).netRecovery())
                .isEqualByComparingTo(new BigDecimal("600"));
        assertThat(byDisposition(result).get(Disposition.RESTOCK).eligible()).isFalse();
        assertThat(byDisposition(result).get(Disposition.RESELL).eligible()).isFalse();
    }

    @Test
    void economicsBeatConditionForResell() {
        DispositionResult result = engine.evaluate(input(
                PhysicalCondition.FAIR, PackagingCondition.OPENED, true,
                FunctionalTestResult.PASSED, "2000", ReturnReason.CHANGED_MIND,
                Instant.now().minus(5, ChronoUnit.DAYS)));

        // Refurbish is eligible (FAIR) but destroys value: 1600-400-600=600.
        // As-is resale nets 1400-400=1000 and wins.
        assertThat(result.recommended()).isEqualTo(Disposition.RESELL);
        assertThat(byDisposition(result).get(Disposition.REFURBISH).eligible()).isTrue();
    }

    @Test
    void defectiveInsideVendorWindowGoesToVendor() {
        DispositionResult result = engine.evaluate(input(
                PhysicalCondition.DAMAGED, PackagingCondition.DAMAGED, false,
                FunctionalTestResult.FAILED, "2000", ReturnReason.DEFECTIVE,
                Instant.now().minus(5, ChronoUnit.DAYS)));

        assertThat(result.recommended()).isEqualTo(Disposition.RETURN_TO_VENDOR);
        // 2000 * 1.00 - 150 - 250 = 1600
        assertThat(byDisposition(result).get(Disposition.RETURN_TO_VENDOR).netRecovery())
                .isEqualByComparingTo(new BigDecimal("1600"));
    }

    @Test
    void expiredVendorWindowFallsBackToRefurbish() {
        DispositionResult result = engine.evaluate(input(
                PhysicalCondition.FAIR, PackagingCondition.OPENED, true,
                FunctionalTestResult.FAILED, "2000", ReturnReason.DEFECTIVE,
                Instant.now().minus(60, ChronoUnit.DAYS)));

        assertThat(byDisposition(result).get(Disposition.RETURN_TO_VENDOR).eligible()).isFalse();
        assertThat(result.recommended()).isEqualTo(Disposition.REFURBISH);
    }

    @Test
    void irreparableItemFallsBackToLiquidation() {
        DispositionResult result = engine.evaluate(input(
                PhysicalCondition.DAMAGED, PackagingCondition.MISSING, false,
                FunctionalTestResult.FAILED, "2000", ReturnReason.OTHER, null));

        Map<Disposition, DispositionCandidate> candidates = byDisposition(result);
        assertThat(candidates.get(Disposition.SCRAP).eligible()).isTrue();
        assertThat(candidates.get(Disposition.RECYCLE).eligible()).isTrue();
        assertThat(candidates.get(Disposition.RETURN_TO_VENDOR).eligible()).isFalse();
        // Liquidation still nets the most: 700-400=300 vs recycle -200 vs scrap -400.
        assertThat(result.recommended()).isEqualTo(Disposition.LIQUIDATE);
    }

    @Test
    void ineligibleOptionsStayVisibleWithReasons() {
        DispositionResult result = engine.evaluate(input(
                PhysicalCondition.EXCELLENT, PackagingCondition.SEALED, true,
                FunctionalTestResult.PASSED, "500", ReturnReason.CHANGED_MIND,
                Instant.now().minus(2, ChronoUnit.DAYS)));

        assertThat(result.candidates()).hasSize(7);
        assertThat(result.candidates())
                .filteredOn(c -> !c.eligible())
                .allSatisfy(c -> assertThat(c.reason()).isNotBlank());
        assertThat(result.candidates())
                .filteredOn(DispositionCandidate::eligible)
                .allSatisfy(c -> assertThat(c.reason()).isNotBlank());
    }

    @Test
    void evaluationIsDeterministic() {
        DispositionInput in = input(
                PhysicalCondition.GOOD, PackagingCondition.OPENED, true,
                FunctionalTestResult.PASSED, "999", ReturnReason.WRONG_SIZE,
                Instant.now().minus(3, ChronoUnit.DAYS));

        DispositionResult first = engine.evaluate(in);
        DispositionResult second = engine.evaluate(in);

        assertThat(second.recommended()).isEqualTo(first.recommended());
        assertThat(second.candidates()).isEqualTo(first.candidates());
    }
}
