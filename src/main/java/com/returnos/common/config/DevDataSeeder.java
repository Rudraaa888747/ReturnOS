package com.returnos.common.config;

import com.returnos.order.Order;
import com.returnos.order.OrderItem;
import com.returnos.order.OrderRepository;
import com.returnos.order.OrderStatus;
import com.returnos.product.Product;
import com.returnos.product.ProductRepository;
import com.returnos.user.Role;
import com.returnos.user.User;
import com.returnos.user.UserRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * Development-only seed data. Never enabled in production.
 * Activate with SPRING_PROFILES_ACTIVE=dev and returnos.seed.enabled=true (default true in dev profile).
 */
@Component
public class DevDataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DevDataSeeder.class);

    private final boolean enabled;
    private final UserRepository users;
    private final ProductRepository products;
    private final OrderRepository orders;
    private final PasswordEncoder passwordEncoder;

    public DevDataSeeder(
            @Value("${returnos.seed.enabled:false}") boolean enabled,
            UserRepository users,
            ProductRepository products,
            OrderRepository orders,
            PasswordEncoder passwordEncoder) {
        this.enabled = enabled;
        this.users = users;
        this.products = products;
        this.orders = orders;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!enabled) {
            return;
        }
        if (users.count() > 0) {
            log.info("Seed skipped: users already exist");
            return;
        }
        log.warn("Seeding DEVELOPMENT-ONLY sample data (do not use in production)");

        User customer = new User("customer@returnos.dev", passwordEncoder.encode("Customer123!"), "Demo Customer", Role.CUSTOMER);
        User staff = new User("staff@returnos.dev", passwordEncoder.encode("Staff12345!"), "Warehouse Staff", Role.WAREHOUSE_STAFF);
        User admin = new User("admin@returnos.dev", passwordEncoder.encode("Admin12345!"), "Admin", Role.ADMIN);
        users.saveAll(List.of(customer, staff, admin));

        Product p1 = new Product("SKU-HEADPH-001", "Aurora Headphones", "electronics", "Wireless over-ear headphones", new BigDecimal("2999.00"), true);
        Product p2 = new Product("SKU-KETTLE-002", "Kettle Pro 1.7L", "home-appliances", "Electric kettle", new BigDecimal("1499.00"), true);
        Product p3 = new Product("SKU-SHIRT-003", "Cotton Shirt", "apparel", "Slim-fit cotton shirt", new BigDecimal("799.00"), true);
        Product p4 = new Product("SKU-FINAL-004", "Final Sale Mug", "final-sale", "Non-returnable final sale item", new BigDecimal("299.00"), true);
        products.saveAll(List.of(p1, p2, p3, p4));

        // Delivered order (eligible for return)
        Order delivered = new Order("ORD-DEV0000001", customer);
        delivered.addItem(new OrderItem(p1, 1));
        delivered.addItem(new OrderItem(p3, 2));
        delivered.recalculate();
        delivered.setStatus(OrderStatus.DELIVERED);
        delivered.setDeliveredAt(Instant.now().minus(5, ChronoUnit.DAYS));
        orders.save(delivered);

        // Placed order (not yet eligible)
        Order placed = new Order("ORD-DEV0000002", customer);
        placed.addItem(new OrderItem(p2, 1));
        placed.recalculate();
        orders.save(placed);

        log.warn("Seeded users: customer@returnos.dev / staff@returnos.dev / admin@returnos.dev (see logs, dev only)");
    }
}
