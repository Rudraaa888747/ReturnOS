package com.returnos.audit;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuditService {

    private final AuditLogRepository auditLogs;

    public AuditService(AuditLogRepository auditLogs) {
        this.auditLogs = auditLogs;
    }

    @Transactional(propagation = Propagation.REQUIRED)
    public void log(
            AuditAction action, String entityType, String entityId,
            String performedBy, String reason, String metadata) {
        auditLogs.save(new AuditLog(action, entityType, entityId, performedBy, reason, metadata));
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void logInNewTransaction(
            AuditAction action, String entityType, String entityId,
            String performedBy, String reason, String metadata) {
        auditLogs.save(new AuditLog(action, entityType, entityId, performedBy, reason, metadata));
    }
}
