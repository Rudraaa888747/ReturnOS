package com.returnos.returns;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * Explicit receiving channel for an approved return.
 *
 * <ul>
 *   <li>{@code SHIPPED} - normal carrier shipment; the return must be {@code IN_TRANSIT}.</li>
 *   <li>{@code COUNTER} - counter / drop-off return handed over in person; the return must be
 *       {@code APPROVED} (it never travels, so it never becomes {@code IN_TRANSIT}).</li>
 * </ul>
 */
@Schema(description = "How the returned goods physically arrived at the warehouse")
public enum ReceiveMode {
    @Schema(description = "Normal carrier shipment; requires status IN_TRANSIT")
    SHIPPED,
    @Schema(description = "Counter / drop-off handover; requires status APPROVED")
    COUNTER
}
