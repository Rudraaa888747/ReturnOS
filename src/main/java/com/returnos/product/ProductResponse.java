package com.returnos.product;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record ProductResponse(
        UUID id, String sku, String name, String category, String description,
        BigDecimal price, boolean active, Instant createdAt, Instant updatedAt) {
    public static ProductResponse from(Product p) {
        return new ProductResponse(
                p.getId(), p.getSku(), p.getName(), p.getCategory(), p.getDescription(),
                p.getPrice(), p.isActive(), p.getCreatedAt(), p.getUpdatedAt());
    }
}
