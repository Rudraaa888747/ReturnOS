package com.returnos.execution;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.returnos.disposition.Disposition;
import com.returnos.order.Order;
import com.returnos.order.OrderItem;
import com.returnos.order.OrderRepository;
import com.returnos.product.Product;
import com.returnos.product.ProductRepository;
import com.returnos.returns.Return;
import com.returnos.returns.ReturnRepository;
import com.returnos.user.Role;
import com.returnos.user.User;
import com.returnos.user.UserRepository;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.transaction.TestTransaction;
import org.springframework.transaction.annotation.Transactional;

/**
 * Proves optimistic locking across genuinely separate transactions: a stale
 * copy committed after a concurrent winner must fail instead of silently
 * overwriting the execution state.
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class ExecutionConcurrencyTest {

    @Autowired
    private DispositionExecutionRepository executions;

    @Autowired
    private ReturnRepository returns;

    @Autowired
    private OrderRepository orders;

    @Autowired
    private ProductRepository products;

    @Autowired
    private UserRepository users;

    @Test
    void staleConcurrentWriteIsRejectedByOptimisticLocking() {
        // Seed inside the test-managed transaction, then commit it so later
        // transactions observe the fixture.
        UUID executionId = seedExecution();
        TestTransaction.flagForCommit();
        TestTransaction.end();

        // Transaction 1 reads (stale copy) and commits without changes.
        TestTransaction.start();
        DispositionExecution stale = executions.findById(executionId).orElseThrow();
        assertThat(stale.getStatus()).isEqualTo(ExecutionStatus.PENDING);
        TestTransaction.flagForCommit();
        TestTransaction.end();

        // Transaction 2 (the concurrent winner) moves PENDING -> IN_PROGRESS.
        TestTransaction.start();
        DispositionExecution winner = executions.findById(executionId).orElseThrow();
        winner.transitionTo(ExecutionStatus.IN_PROGRESS);
        executions.saveAndFlush(winner);
        TestTransaction.flagForCommit();
        TestTransaction.end();

        // Transaction 3 replays the stale copy: merge must detect the version
        // conflict instead of overwriting IN_PROGRESS.
        TestTransaction.start();
        try {
            stale.transitionTo(ExecutionStatus.IN_PROGRESS);
            assertThatThrownBy(() -> executions.saveAndFlush(stale))
                    .isInstanceOf(ObjectOptimisticLockingFailureException.class);
        } finally {
            TestTransaction.flagForRollback();
            TestTransaction.end();
        }

        // Winner state survived: still exactly one IN_PROGRESS execution.
        TestTransaction.start();
        try {
            DispositionExecution current = executions.findById(executionId).orElseThrow();
            assertThat(current.getStatus()).isEqualTo(ExecutionStatus.IN_PROGRESS);
        } finally {
            TestTransaction.flagForRollback();
            TestTransaction.end();
        }
    }

    private UUID seedExecution() {
        User customer = users.save(new User(
                "conc+" + UUID.randomUUID() + "@returnos.test", "hash", "Concurrent", Role.CUSTOMER));
        Product product = products.save(new Product(
                "SKU-CONC-" + UUID.randomUUID().toString().substring(0, 8),
                "Concurrency Widget", "electronics", "concurrency test",
                new BigDecimal("100.00"), true));
        Order order = new Order("ORD-CONC-" + UUID.randomUUID().toString().substring(0, 8), customer);
        order.addItem(new OrderItem(product, 1));
        orders.save(order);
        Return productReturn = returns.save(new Return(
                "RET-CONC-" + UUID.randomUUID().toString().substring(0, 8), order, customer));
        return executions
                .saveAndFlush(new DispositionExecution(productReturn, Disposition.RESTOCK))
                .getId();
    }
}
