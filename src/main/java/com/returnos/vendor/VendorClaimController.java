package com.returnos.vendor;

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
@RequestMapping("/api/v1/returns/{returnId}/vendor-claim")
@Tag(name = "VendorClaim")
public class VendorClaimController {

    private final VendorClaimService claimService;

    public VendorClaimController(VendorClaimService claimService) {
        this.claimService = claimService;
    }

    @GetMapping
    @Operation(
            summary = "Get vendor claim (own returns for customers, all for staff/admin)",
            description = "404 when no claim was opened for the return.")
    public ResponseEntity<VendorDtos.VendorClaimResponse> get(@PathVariable UUID returnId) {
        return ResponseEntity.ok(claimService.get(returnId));
    }

    @PostMapping
    @Operation(
            summary = "Open vendor claim (staff/admin)",
            description = "Creates a DRAFT claim. Requires final disposition RETURN_TO_VENDOR and an "
                    + "IN_PROGRESS execution. One claim per execution: repeats are rejected "
                    + "(400 DUPLICATE_CLAIM) by check and unique constraint.")
    public ResponseEntity<VendorDtos.VendorClaimResponse> create(
            @PathVariable UUID returnId, @Valid @RequestBody VendorDtos.CreateClaimRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(claimService.create(
                        returnId, request.vendorReference(), request.expectedCredit(), request.notes()));
    }

    @PostMapping("/submit")
    @Operation(summary = "Submit claim (staff/admin)", description = "DRAFT → SUBMITTED.")
    public ResponseEntity<VendorDtos.VendorClaimResponse> submit(@PathVariable UUID returnId) {
        return ResponseEntity.ok(claimService.submit(returnId));
    }

    @PostMapping("/acknowledge")
    @Operation(summary = "Acknowledge claim (staff/admin)", description = "SUBMITTED → ACKNOWLEDGED.")
    public ResponseEntity<VendorDtos.VendorClaimResponse> acknowledge(@PathVariable UUID returnId) {
        return ResponseEntity.ok(claimService.acknowledge(returnId));
    }

    @PostMapping("/approve")
    @Operation(summary = "Approve claim (staff/admin)", description = "ACKNOWLEDGED → APPROVED.")
    public ResponseEntity<VendorDtos.VendorClaimResponse> approve(@PathVariable UUID returnId) {
        return ResponseEntity.ok(claimService.approve(returnId));
    }

    @PostMapping("/reject")
    @Operation(
            summary = "Reject claim (staff/admin)",
            description = "SUBMITTED/ACKNOWLEDGED → REJECTED. A reason is mandatory.")
    public ResponseEntity<VendorDtos.VendorClaimResponse> reject(
            @PathVariable UUID returnId, @Valid @RequestBody VendorDtos.RejectClaimRequest request) {
        return ResponseEntity.ok(claimService.reject(returnId, request.reason()));
    }

    @PostMapping("/settle")
    @Operation(
            summary = "Settle claim (staff/admin)",
            description = "APPROVED → SETTLED. Records the actual vendor credit, defaulting to the "
                    + "expected credit when omitted, and distinguishes expected vs actual recovery.")
    public ResponseEntity<VendorDtos.VendorClaimResponse> settle(
            @PathVariable UUID returnId, @Valid @RequestBody VendorDtos.SettleClaimRequest request) {
        return ResponseEntity.ok(claimService.settle(returnId, request.actualCredit(), request.notes()));
    }
}
