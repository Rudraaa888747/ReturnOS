package com.returnos.inspection;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

public final class InspectionDtos {

    private InspectionDtos() {}

    public record CreateInspectionRequest(
            @NotNull PhysicalCondition physicalCondition,
            @NotNull PackagingCondition packagingCondition,
            @NotNull Boolean accessoriesComplete,
            @NotNull FunctionalTestResult functionalTestResult,
            @Size(max = 1000) String visibleDamage,
            @Size(max = 2000) String notes) {}

    public record InspectionResponse(
            UUID id, UUID returnId,
            PhysicalCondition physicalCondition,
            PackagingCondition packagingCondition,
            boolean accessoriesComplete,
            FunctionalTestResult functionalTestResult,
            String visibleDamage, String notes,
            UUID inspectedBy, Instant inspectedAt) {
        public static InspectionResponse from(Inspection i) {
            return new InspectionResponse(
                    i.getId(), i.getProductReturn().getId(),
                    i.getPhysicalCondition(), i.getPackagingCondition(),
                    i.isAccessoriesComplete(), i.getFunctionalTestResult(),
                    i.getVisibleDamage(), i.getNotes(),
                    i.getInspectedBy() != null ? i.getInspectedBy().getId() : null,
                    i.getInspectedAt());
        }
    }
}
