package com.returnos.disposition;

import java.time.Instant;
import java.util.List;

/** Full evaluation: every candidate plus the selected recommendation. */
public record DispositionResult(Disposition recommended, List<DispositionCandidate> candidates, Instant evaluatedAt) {

    public DispositionResult {
        candidates = candidates != null ? List.copyOf(candidates) : List.of();
    }
}
