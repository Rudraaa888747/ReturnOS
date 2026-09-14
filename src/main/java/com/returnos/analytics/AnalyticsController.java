package com.returnos.analytics;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin/analytics")
@Tag(name = "Analytics")
@PreAuthorize("hasRole('ADMIN')")
public class AnalyticsController {

    private final AnalyticsService analyticsService;

    public AnalyticsController(AnalyticsService analyticsService) {
        this.analyticsService = analyticsService;
    }

    @GetMapping("/returns")
    @Operation(
            summary = "Return operations analytics (admin only)",
            description = "Read-only aggregates computed in the database: total returns, evaluated vs "
                    + "finalized counts, returns by final disposition, execution completion rate, "
                    + "average execution time and failed executions.")
    public ResponseEntity<AnalyticsDtos.ReturnsAnalyticsResponse> returns() {
        return ResponseEntity.ok(analyticsService.returnsSummary());
    }

    @GetMapping("/recovery")
    @Operation(
            summary = "Recovery analytics (admin only)",
            description = "Read-only money aggregates: expected vs actual vs net recovery, vendor "
                    + "claim settlement rate and credits, restock quantities, recycle/scrap counts "
                    + "and liquidation recovery.")
    public ResponseEntity<AnalyticsDtos.RecoveryAnalyticsResponse> recovery() {
        return ResponseEntity.ok(analyticsService.recoverySummary());
    }
}
