package com.returnos.disposition;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/returns/{returnId}/disposition")
@Tag(name = "Disposition")
public class DispositionController {

    private final DispositionService dispositionService;

    public DispositionController(DispositionService dispositionService) {
        this.dispositionService = dispositionService;
    }

    @PostMapping("/evaluate")
    @Operation(
            summary = "Evaluate disposition (staff/admin)",
            description = "Runs the deterministic disposition engine over the completed inspection. "
                    + "Requires INSPECTION_COMPLETED. Idempotent: 201 on first evaluation, "
                    + "200 with the stored evaluation on repeats. Always falls back to LIQUIDATE, "
                    + "so a recommendation always exists.")
    public ResponseEntity<DispositionDtos.EvaluationResponse> evaluate(@PathVariable UUID returnId) {
        DispositionService.EvaluateOutcome outcome = dispositionService.evaluate(returnId);
        return ResponseEntity.status(outcome.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .body(outcome.response());
    }

    @GetMapping
    @Operation(
            summary = "Get disposition evaluation (own returns for customers, all for staff/admin)",
            description = "Returns the recommendation with every candidate evaluation, "
                    + "estimated recovery values and reasons, plus final-disposition/override state. "
                    + "404 when the return was not evaluated yet.")
    public ResponseEntity<DispositionDtos.EvaluationResponse> get(@PathVariable UUID returnId) {
        return ResponseEntity.ok(dispositionService.get(returnId));
    }

    @PostMapping("/finalize")
    @Operation(
            summary = "Record final disposition (staff/admin)",
            description = "Accepts the recommendation when `disposition` is omitted. Recording a "
                    + "different channel is an override: admin only, and `overrideReason` is required. "
                    + "A second finalization is rejected (400 ALREADY_FINALIZED).")
    public ResponseEntity<DispositionDtos.EvaluationResponse> finalizeDisposition(
            @PathVariable UUID returnId, @Valid @RequestBody(required = false) DispositionDtos.FinalizeRequest request) {
        Disposition disposition = request != null ? request.disposition() : null;
        String reason = request != null ? request.overrideReason() : null;
        return ResponseEntity.ok(dispositionService.finalizeDisposition(returnId, disposition, reason));
    }

    @PostMapping("/override")
    @Operation(
            summary = "Override recommendation (admin only)",
            description = "Explicit admin override to a different channel with a mandatory reason. "
                    + "The original recommendation is preserved and both DISPOSITION_OVERRIDDEN and "
                    + "FINAL_DISPOSITION_RECORDED audit events are written.")
    public ResponseEntity<DispositionDtos.EvaluationResponse> override(
            @PathVariable UUID returnId, @Valid @RequestBody DispositionDtos.OverrideRequest request) {
        return ResponseEntity.ok(dispositionService.override(returnId, request.disposition(), request.reason()));
    }
}
