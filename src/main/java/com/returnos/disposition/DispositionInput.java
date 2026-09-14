package com.returnos.disposition;

import com.returnos.inspection.FunctionalTestResult;
import com.returnos.inspection.PackagingCondition;
import com.returnos.inspection.PhysicalCondition;
import com.returnos.returns.ReturnReason;
import java.math.BigDecimal;
import java.time.Instant;

/**
 * Everything the disposition engine may consider: the Phase-1 inspection
 * outcome plus the goods value and order context. No external data.
 */
public record DispositionInput(
        PhysicalCondition physicalCondition,
        PackagingCondition packagingCondition,
        boolean accessoriesComplete,
        FunctionalTestResult functionalTestResult,
        BigDecimal goodsValue,
        ReturnReason primaryReason,
        Instant deliveredAt,
        Instant evaluatedAt) {

    public DispositionInput {
        goodsValue = goodsValue != null ? goodsValue : BigDecimal.ZERO;
        evaluatedAt = evaluatedAt != null ? evaluatedAt : Instant.now();
    }
}
