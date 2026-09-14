package com.returnos.recovery;

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
@RequestMapping("/api/v1/returns/{returnId}/recovery")
@Tag(name = "Recovery")
public class RecoveryController {

    private final RecoveryService recoveryService;

    public RecoveryController(RecoveryService recoveryService) {
        this.recoveryService = recoveryService;
    }

    @GetMapping
    @Operation(
            summary = "Get recovery record (own returns for customers, all for staff/admin)",
            description = "Shows expected vs actual recovery. 404 when no record was opened.")
    public ResponseEntity<RecoveryDtos.RecoveryResponse> get(@PathVariable UUID returnId) {
        return ResponseEntity.ok(recoveryService.get(returnId));
    }

    @PostMapping
    @Operation(
            summary = "Open recovery record (staff/admin)",
            description = "Requires final disposition RESELL or LIQUIDATE and an IN_PROGRESS execution. "
                    + "Expected recovery defaults to the evaluated net of the final channel. "
                    + "One record per execution: repeats are rejected (400 DUPLICATE_RECOVERY).")
    public ResponseEntity<RecoveryDtos.RecoveryResponse> create(
            @PathVariable UUID returnId, @Valid @RequestBody RecoveryDtos.CreateRecoveryRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(recoveryService.create(
                        returnId, request.channel(), request.listedValue(), request.expectedRecovery(), request.notes()));
    }

    @PostMapping("/list")
    @Operation(summary = "List recovery for sale (staff/admin)", description = "PENDING → LISTED.")
    public ResponseEntity<RecoveryDtos.RecoveryResponse> list(@PathVariable UUID returnId) {
        return ResponseEntity.ok(recoveryService.list(returnId));
    }

    @PostMapping("/sell")
    @Operation(
            summary = "Record sale (staff/admin)",
            description = "LISTED → SOLD with actual money in and fees out. Net is recomputed; "
                    + "this separates expected from actual recovery.")
    public ResponseEntity<RecoveryDtos.RecoveryResponse> sell(
            @PathVariable UUID returnId, @Valid @RequestBody RecoveryDtos.SellRecoveryRequest request) {
        return ResponseEntity.ok(
                recoveryService.sell(returnId, request.actualRecovered(), request.fees(), request.notes()));
    }

    @PostMapping("/settle")
    @Operation(summary = "Settle recovery (staff/admin)", description = "SOLD → SETTLED. Duplicate settlement rejected.")
    public ResponseEntity<RecoveryDtos.RecoveryResponse> settle(@PathVariable UUID returnId) {
        return ResponseEntity.ok(recoveryService.settle(returnId));
    }

    @PostMapping("/fail")
    @Operation(summary = "Fail recovery (staff/admin)", description = "Marks the recovery FAILED with a reason.")
    public ResponseEntity<RecoveryDtos.RecoveryResponse> fail(
            @PathVariable UUID returnId, @Valid @RequestBody RecoveryDtos.FailRecoveryRequest request) {
        return ResponseEntity.ok(recoveryService.fail(returnId, request.reason()));
    }

    @PostMapping("/correct")
    @Operation(
            summary = "Correct settled figures (admin only)",
            description = "Admin-only correction of actual/fees on SOLD or SETTLED records. "
                    + "Reason is mandatory and every correction is audited (OPERATIONAL_CORRECTION).")
    public ResponseEntity<RecoveryDtos.RecoveryResponse> correct(
            @PathVariable UUID returnId, @Valid @RequestBody RecoveryDtos.CorrectRecoveryRequest request) {
        return ResponseEntity.ok(
                recoveryService.correct(returnId, request.actualRecovered(), request.fees(), request.reason()));
    }
}
