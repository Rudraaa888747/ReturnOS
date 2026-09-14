package com.returnos.audit;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/audit-logs")
@Tag(name = "Audit")
public class AuditController {

    private final AuditLogRepository auditLogs;

    public AuditController(AuditLogRepository auditLogs) {
        this.auditLogs = auditLogs;
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('WAREHOUSE_STAFF', 'ADMIN')")
    @Operation(summary = "List audit logs (staff/admin)")
    public ResponseEntity<Page<AuditResponse>> list(
            @RequestParam(required = false) String entityType,
            @RequestParam(required = false) String entityId,
            @PageableDefault(size = 50) Pageable pageable) {
        Page<AuditLog> page;
        if (entityType != null && entityId != null) {
            page = auditLogs.findByEntityTypeAndEntityIdOrderByCreatedAtDesc(entityType, entityId, pageable);
        } else {
            page = auditLogs.findAllByOrderByCreatedAtDesc(pageable);
        }
        return ResponseEntity.ok(page.map(AuditResponse::from));
    }

    public record AuditResponse(
            String id, AuditAction action, String entityType, String entityId,
            String performedBy, String reason, String metadata, java.time.Instant createdAt) {
        static AuditResponse from(AuditLog log) {
            return new AuditResponse(
                    log.getId().toString(), log.getAction(), log.getEntityType(), log.getEntityId(),
                    log.getPerformedBy(), log.getReason(), log.getMetadata(), log.getCreatedAt());
        }
    }
}
