package com.returnos.history;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/returns/{returnId}/history")
@Tag(name = "History")
public class HistoryController {

    private final HistoryService historyService;

    public HistoryController(HistoryService historyService) {
        this.historyService = historyService;
    }

    @GetMapping
    @Operation(
            summary = "Get full operational history of a return",
            description = "Aggregates lifecycle, inspection, risk, disposition, execution, channel "
                    + "records, tasks and the chronological audit trail into one structured view. "
                    + "Customers see only their own returns and no actor identities.")
    public ResponseEntity<HistoryDtos.ReturnHistoryResponse> history(@PathVariable UUID returnId) {
        return ResponseEntity.ok(historyService.getHistory(returnId));
    }
}
