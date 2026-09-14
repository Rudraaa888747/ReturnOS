package com.returnos.inventory;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/returns/{returnId}")
@Tag(name = "Restock")
public class RestockController {

    private final InventoryRecoveryService restockService;

    public RestockController(InventoryRecoveryService restockService) {
        this.restockService = restockService;
    }

    @PostMapping("/restock")
    @Operation(
            summary = "Record inventory restocking (staff/admin)",
            description = "Requires final disposition RESTOCK and an IN_PROGRESS execution. "
                    + "Idempotent per execution: repeats are rejected (400 DUPLICATE_RESTOCK) "
                    + "by check and unique constraint, so stock is never double-counted.")
    public ResponseEntity<InventoryDtos.InventoryRecoveryResponse> restock(
            @PathVariable UUID returnId, @Valid @RequestBody InventoryDtos.RestockRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(restockService.restock(returnId, request.quantity(), request.recoveredQuantity(), request.destination()));
    }
}
