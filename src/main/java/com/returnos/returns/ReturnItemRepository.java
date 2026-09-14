package com.returnos.returns;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ReturnItemRepository extends JpaRepository<ReturnItem, UUID> {

    @Query("""
            select coalesce(sum(ri.quantity), 0) from ReturnItem ri
            join ri.productReturn r
            where r.order.id = :orderId
              and ri.orderItem.id = :orderItemId
              and r.status <> com.returnos.returns.ReturnStatus.REJECTED
            """)
    long sumActiveReturnedQuantity(
            @Param("orderId") UUID orderId, @Param("orderItemId") UUID orderItemId);

    List<ReturnItem> findByProductReturnId(UUID returnId);
}
