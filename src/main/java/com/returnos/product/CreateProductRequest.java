package com.returnos.product;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

public record CreateProductRequest(
        @NotBlank @Size(max = 64) String sku,
        @NotBlank @Size(max = 255) String name,
        @NotBlank @Size(max = 128) String category,
        @Size(max = 2000) String description,
        @NotNull @DecimalMin(value = "0.0", inclusive = true) BigDecimal price) {}
