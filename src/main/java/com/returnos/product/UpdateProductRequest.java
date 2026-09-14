package com.returnos.product;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

public record UpdateProductRequest(
        @Size(max = 255) String name,
        @Size(max = 128) String category,
        @Size(max = 2000) String description,
        @DecimalMin(value = "0.0", inclusive = true) BigDecimal price,
        Boolean active) {}
