package com.returnos.risk;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/returns/{returnId}/risk")
@Tag(name = "Risk")
public class RiskController {

    private final RiskService riskService;

    public RiskController(RiskService riskService) {
        this.riskService = riskService;
    }

    @PostMapping("/assess")
    @Operation(
            summary = "Assess return risk (staff/admin)",
            description = "Runs the deterministic rule-based risk engine. Requires a completed inspection. "
                    + "Idempotent: returns 201 on first assessment, 200 with the stored assessment on repeats. "
                    + "The score is an operational attention signal, never a fraud accusation.")
    public ResponseEntity<RiskDtos.RiskAssessmentResponse> assess(@PathVariable UUID returnId) {
        RiskService.AssessOutcome outcome = riskService.assess(returnId);
        return ResponseEntity.status(outcome.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .body(outcome.response());
    }

    @GetMapping
    @Operation(
            summary = "Get risk assessment (own returns for customers, all for staff/admin)",
            description = "Returns the stored assessment with score, level and contributing rule explanations. "
                    + "404 when the return was not assessed yet.")
    public ResponseEntity<RiskDtos.RiskAssessmentResponse> get(@PathVariable UUID returnId) {
        return ResponseEntity.ok(riskService.get(returnId));
    }
}
