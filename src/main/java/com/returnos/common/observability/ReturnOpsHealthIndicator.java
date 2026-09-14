package com.returnos.common.observability;

import com.returnos.execution.DispositionExecutionRepository;
import com.returnos.execution.ExecutionStatus;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.stereotype.Component;

/**
 * Operational slice of application health: pending/in-progress/failed
 * execution counts. Informational only - never fails the application health
 * on its own and exposes no secrets.
 */
@Component("returnOps")
public class ReturnOpsHealthIndicator implements HealthIndicator {

    private final DispositionExecutionRepository executions;

    public ReturnOpsHealthIndicator(DispositionExecutionRepository executions) {
        this.executions = executions;
    }

    @Override
    public Health health() {
        try {
            return Health.up()
                    .withDetail("pendingExecutions", executions.countByStatus(ExecutionStatus.PENDING))
                    .withDetail("inProgressExecutions", executions.countByStatus(ExecutionStatus.IN_PROGRESS))
                    .withDetail("failedExecutions", executions.countByStatus(ExecutionStatus.FAILED))
                    .build();
        } catch (Exception e) {
            return Health.up().withDetail("operationalInfo", "unavailable").build();
        }
    }
}
