package com.returnos.product;

import com.returnos.common.exception.BusinessException;
import com.returnos.common.exception.ResourceNotFoundException;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProductService {

    private final ProductRepository products;

    public ProductService(ProductRepository products) {
        this.products = products;
    }

    @Transactional
    public ProductResponse create(CreateProductRequest request) {
        if (products.existsBySku(request.sku())) {
            throw new BusinessException("SKU_TAKEN", "Product with SKU already exists: " + request.sku());
        }
        Product product = new Product(
                request.sku().trim(),
                request.name().trim(),
                request.category().trim(),
                request.description(),
                request.price(),
                true);
        products.save(product);
        return ProductResponse.from(product);
    }

    @Transactional(readOnly = true)
    public ProductResponse getById(UUID id) {
        return products.findById(id)
                .map(ProductResponse::from)
                .orElseThrow(() -> new ResourceNotFoundException("PRODUCT_NOT_FOUND", "Product not found: " + id));
    }

    @Transactional(readOnly = true)
    public Page<ProductResponse> list(String category, Boolean active, Pageable pageable) {
        boolean onlyActive = active == null || active;
        Page<Product> page;
        if (category != null && !category.isBlank()) {
            page = products.findByCategoryAndActive(category.trim(), onlyActive, pageable);
        } else if (active != null && !active) {
            page = products.findByActive(false, pageable);
        } else {
            page = products.findByActive(true, pageable);
        }
        return page.map(ProductResponse::from);
    }

    @Transactional
    public ProductResponse update(UUID id, UpdateProductRequest request) {
        Product product = products.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("PRODUCT_NOT_FOUND", "Product not found: " + id));
        if (request.name() != null && !request.name().isBlank()) product.setName(request.name().trim());
        if (request.category() != null && !request.category().isBlank()) product.setCategory(request.category().trim());
        if (request.description() != null) product.setDescription(request.description());
        if (request.price() != null) product.setPrice(request.price());
        if (request.active() != null) product.setActive(request.active());
        return ProductResponse.from(product);
    }
}
