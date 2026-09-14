package com.returnos.disposition;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.returnos.common.exception.BusinessException;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class RecoveryCalculatorTest {

    private final RecoveryCalculator calculator = new RecoveryCalculator();

    @Test
    void normalNetRecoveryCalculation() {
        RecoveryBreakdown result =
                calculator.calculate(new BigDecimal("8000"), new BigDecimal("150"), new BigDecimal("250"), new BigDecimal("600"));

        assertThat(result.netRecovery()).isEqualByComparingTo(new BigDecimal("7000"));
        assertThat(result.recoveryValue()).isEqualByComparingTo(new BigDecimal("8000"));
    }

    @Test
    void zeroCostsReturnFullRecovery() {
        RecoveryBreakdown result =
                calculator.calculate(new BigDecimal("1000"), BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO);

        assertThat(result.netRecovery()).isEqualByComparingTo(new BigDecimal("1000"));
    }

    @Test
    void highRefurbishmentCostCanYieldNegativeNet() {
        RecoveryBreakdown result =
                calculator.calculate(new BigDecimal("500"), new BigDecimal("150"), new BigDecimal("250"), new BigDecimal("600"));

        assertThat(result.netRecovery()).isEqualByComparingTo(new BigDecimal("-500"));
    }

    @Test
    void amountsAreRoundedHalfUpToScale2() {
        RecoveryBreakdown result =
                calculator.calculate(new BigDecimal("10.005"), BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO);

        assertThat(result.recoveryValue()).isEqualByComparingTo(new BigDecimal("10.01"));
        assertThat(result.recoveryValue().scale()).isEqualTo(2);
        assertThat(result.netRecovery().scale()).isEqualTo(2);
    }

    @Test
    void negativeInputIsRejected() {
        assertThatThrownBy(() -> calculator.calculate(
                        new BigDecimal("100"), new BigDecimal("-1"), BigDecimal.ZERO, BigDecimal.ZERO))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("cannot be negative");
    }

    @Test
    void nullInputIsRejected() {
        assertThatThrownBy(() -> calculator.calculate(null, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO))
                .isInstanceOf(BusinessException.class);
    }
}
