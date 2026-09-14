package com.returnos.common.observability;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

/** Lightweight operational counters exposed via Actuator /metrics. */
@Component
public class OperationsMetrics {

    private final Counter executionsStarted;
    private final Counter executionsCompleted;
    private final Counter executionsFailed;
    private final Counter recoverySettled;
    private final Counter vendorSettled;
    private final Counter tasksCompleted;

    public OperationsMetrics(MeterRegistry registry) {
        this.executionsStarted = Counter.builder("returnos.executions.started").register(registry);
        this.executionsCompleted = Counter.builder("returnos.executions.completed").register(registry);
        this.executionsFailed = Counter.builder("returnos.executions.failed").register(registry);
        this.recoverySettled = Counter.builder("returnos.recovery.settled").register(registry);
        this.vendorSettled = Counter.builder("returnos.vendor.settled").register(registry);
        this.tasksCompleted = Counter.builder("returnos.tasks.completed").register(registry);
    }

    public void executionStarted() { executionsStarted.increment(); }
    public void executionCompleted() { executionsCompleted.increment(); }
    public void executionFailed() { executionsFailed.increment(); }
    public void recoverySettled() { recoverySettled.increment(); }
    public void vendorSettled() { vendorSettled.increment(); }
    public void taskCompleted() { tasksCompleted.increment(); }
}
