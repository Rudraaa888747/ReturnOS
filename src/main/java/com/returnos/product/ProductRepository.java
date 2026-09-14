package com.returnos.product;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProductRepository extends JpaRepository<Product, UUID> {
    Optional<Product> findBySku(String sku);
    boolean existsBySku(String sku);
    Page<Product> findByActive(boolean active, Pageable pageable);
    Page<Product> findByCategoryAndActive(String category, boolean active, Pageable pageable);
}
