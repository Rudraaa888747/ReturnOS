package com.returnos.disposal;

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
@RequestMapping("/api/v1/returns/{returnId}/disposal")
@Tag(name = "Disposal")
public class DisposalController {

    private final DisposalService disposalService;

    public DisposalController(DisposalService disposalService) {
        this.disposalService = disposalService;
    }

    @PostMapping("/complete")
    @Operation(
            summary = "Complete recycling/scrapping (staff/admin)",
            description = "Requires final disposition RECYCLE or SCRAP and an IN_PROGRESS execution. "
                    + "One record per execution: repeats are rejected (400 DUPLICATE_DISPOSAL).")
    public ResponseEntity<DisposalDtos.DisposalResponse> complete(
            @PathVariable UUID returnId, @Valid @RequestBody DisposalDtos.CompleteDisposalRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(disposalService.complete(
                        returnId,
                        request.quantity(),
                        request.partner(),
                        request.estimatedRecovery(),
                        request.actualRecovery(),
                        request.processingCost(),
                        request.notes()));
    }
}
