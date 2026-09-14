package com.returnos.order;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrderRepository extends JpaRepository<Order, UUID> {

    @EntityGraph(attributePaths = {"items", "items.product", "customer"})
    Optional<Order> findWithItemsById(UUID id);

    @EntityGraph(attributePaths = {"items", "customer"})
    Page<Order> findByCustomerId(UUID customerId, Pageable pageable);

    @EntityGraph(attributePaths = {"items", "customer"})
    Page<Order> findAll(Pageable pageable);

    boolean existsByOrderNumber(String orderNumber);
}
