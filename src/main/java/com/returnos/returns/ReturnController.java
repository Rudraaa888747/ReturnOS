package com.returnos.returns;

import com.returnos.inspection.InspectionDtos;
import com.returnos.inspection.InspectionService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/returns")
@Tag(name = "Returns")
public class ReturnController {

    private final ReturnService returnService;
    private final InspectionService inspectionService;

    public ReturnController(ReturnService returnService, InspectionService inspectionService) {
        this.returnService = returnService;
        this.inspectionService = inspectionService;
    }

    @PostMapping
    @Operation(summary = "Request a return for an order (customer)")
    public ResponseEntity<ReturnDtos.ReturnResponse> create(
            @Valid @RequestBody ReturnDtos.CreateReturnRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(returnService.create(request));
    }

    @GetMapping
    @Operation(summary = "List returns (own for customers, all for staff/admin)")
    public ResponseEntity<Page<ReturnDtos.ReturnResponse>> list(
            @RequestParam(required = false) ReturnStatus status,
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(returnService.list(status, pageable));
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get return by id")
    public ResponseEntity<ReturnDtos.ReturnResponse> getById(@PathVariable UUID id) {
        return ResponseEntity.ok(returnService.getById(id));
    }

    @PostMapping("/{id}/approve")
    @Operation(summary = "Approve a return (staff/admin)")
    public ResponseEntity<ReturnDtos.ReturnResponse> approve(@PathVariable UUID id) {
        return ResponseEntity.ok(returnService.approve(id));
    }

    @PostMapping("/{id}/reject")
    @Operation(summary = "Reject a return (staff/admin)")
    public ResponseEntity<ReturnDtos.ReturnResponse> reject(
            @PathVariable UUID id, @Valid @RequestBody ReturnDtos.RejectReturnRequest request) {
        return ResponseEntity.ok(returnService.reject(id, request.reason()));
    }

    @PostMapping("/{id}/ship")
    @Operation(summary = "Mark approved return as in-transit (customer ships the item)")
    public ResponseEntity<ReturnDtos.ReturnResponse> ship(@PathVariable UUID id) {
        return ResponseEntity.ok(returnService.markInTransit(id));
    }

    @PostMapping("/{id}/receive")
    @Operation(summary = "Mark return as received (staff/admin)")
    public ResponseEntity<ReturnDtos.ReturnResponse> receive(@PathVariable UUID id) {
        return ResponseEntity.ok(returnService.receive(id));
    }

    @PostMapping("/{id}/inspection")
    @Operation(summary = "Create warehouse inspection (staff/admin)")
    public ResponseEntity<InspectionDtos.InspectionResponse> inspect(
            @PathVariable UUID id, @Valid @RequestBody InspectionDtos.CreateInspectionRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(inspectionService.create(id, request));
    }

    @GetMapping("/{id}/inspection")
    @Operation(summary = "Get inspection for a return")
    public ResponseEntity<InspectionDtos.InspectionResponse> getInspection(@PathVariable UUID id) {
        return ResponseEntity.ok(inspectionService.getByReturnId(id));
    }
}
