package com.returnos.storage;

import com.returnos.common.ApiException;
import java.net.URI;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;

/**
 * Document storage behind a single abstraction. The active provider is
 * selected by {@code returnos.storage-provider} ('local' default, 's3').
 * PostgreSQL stores only the opaque object key ({@code storage_path});
 * never a file binary, never credentials.
 */
public interface StorageService {
  Pattern KEY = Pattern.compile("[A-Za-z0-9][A-Za-z0-9/_.-]{0,200}");

  /** Persist bytes under {@code key}. */
  void store(String key, byte[] bytes, String mime);

  /** Load bytes; throws FILE_MISSING when absent. */
  byte[] load(String key);

  /** Delete; absent keys are tolerated. */
  void delete(String key);

  /** Short-lived direct-access URL, if the provider supports it. */
  default Optional<URI> presignedDownload(String key, String filename, String mime) { return Optional.empty(); }

  /** Generated safe key. The original filename is never part of it. */
  static String keyFor(String returnId, String extension) {
    String safe = returnId == null ? "unknown" : returnId.replaceAll("[^A-Za-z0-9-]", "-");
    if (safe.isBlank()) safe = "unknown";
    return "returns/" + safe + "/photos/" + System.currentTimeMillis() + "-" + UUID.randomUUID() + extension;
  }

  static void requireKey(String key) {
    if (key == null || key.contains("..")) invalid();
    if (KEY.matcher(key).matches()) return;
    // Legacy local rows store absolute filesystem paths; only the trailing
    // filename is significant there.
    String name = key.substring(Math.max(key.lastIndexOf('/'), key.lastIndexOf('\\')) + 1);
    if (!KEY.matcher(name).matches()) invalid();
  }

  private static void invalid() {
    throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_OBJECT_KEY", "The requested file reference is invalid");
  }

  static ApiException missing() {
    return new ApiException(HttpStatus.NOT_FOUND, "FILE_MISSING", "Stored file is no longer available");
  }

  static ApiException failed(String op, String key, Exception e) {
    org.slf4j.LoggerFactory.getLogger(StorageService.class).error("Storage {} failed for key {}", op, key, e);
    return new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "STORAGE_ERROR", "Document storage is temporarily unavailable. Please try again.");
  }
}
