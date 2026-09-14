package com.returnos.returns;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReturnRepository extends JpaRepository<Return, UUID> {

    @EntityGraph(attributePaths = {"items", "items.product", "items.orderItem", "order", "customer"})
    Optional<Return> findWithItemsById(UUID id);

    @EntityGraph(attributePaths = {"items", "order", "customer"})
    Page<Return> findByCustomerId(UUID customerId, Pageable pageable);

    @EntityGraph(attributePaths = {"items", "order", "customer"})
    Page<Return> findAll(Pageable pageable);

    @EntityGraph(attributePaths = {"items", "order", "customer"})
    Page<Return> findByStatus(ReturnStatus status, Pageable pageable);

    boolean existsByReturnNumber(String returnNumber);
}
