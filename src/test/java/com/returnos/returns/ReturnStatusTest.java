package com.returnos.returns;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class ReturnStatusTest {

    @ParameterizedTest
    @CsvSource({
        "REQUESTED, APPROVED, true",
        "REQUESTED, REJECTED, true",
        "REQUESTED, RECEIVED, false",
        "REQUESTED, INSPECTION_COMPLETED, false",
        "APPROVED, IN_TRANSIT, true",
        "APPROVED, RECEIVED, true",
        "APPROVED, REJECTED, false",
        "IN_TRANSIT, RECEIVED, true",
        "IN_TRANSIT, APPROVED, false",
        "RECEIVED, INSPECTION_PENDING, true",
        "RECEIVED, INSPECTION_COMPLETED, false",
        "INSPECTION_PENDING, INSPECTION_IN_PROGRESS, true",
        "INSPECTION_IN_PROGRESS, INSPECTION_COMPLETED, true",
        "INSPECTION_COMPLETED, APPROVED, false",
        "REJECTED, APPROVED, false"
    })
    void stateTransitions(ReturnStatus from, ReturnStatus to, boolean expected) {
        assertThat(from.canTransitionTo(to)).isEqualTo(expected);
    }

    @Test
    void terminalStates() {
        assertThat(ReturnStatus.REJECTED.isTerminal()).isTrue();
        assertThat(ReturnStatus.INSPECTION_COMPLETED.isTerminal()).isTrue();
        assertThat(ReturnStatus.REQUESTED.isTerminal()).isFalse();
    }
}
