package com.returnos.storage;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/** Filesystem provider: keeps the historical ./uploads behavior. Keys are
 * bare filenames resolved under the upload directory. */
public class LocalStorageService implements StorageService {
  private final Path dir;

  public LocalStorageService(Path dir) throws IOException {
    this.dir = dir;
    Files.createDirectories(dir);
  }

  @Override public void store(String key, byte[] bytes, String mime) {
    StorageService.requireKey(key);
    String name = fileName(key);
    try {
      Files.write(dir.resolve(name), bytes);
    } catch (IOException e) {
      throw StorageService.failed("upload", key, e);
    }
  }

  @Override public byte[] load(String key) {
    StorageService.requireKey(key);
    Path target = dir.resolve(fileName(key));
    if (!Files.exists(target)) throw StorageService.missing();
    try {
      return Files.readAllBytes(target);
    } catch (IOException e) {
      throw StorageService.failed("download", key, e);
    }
  }

  @Override public void delete(String key) {
    StorageService.requireKey(key);
    try {
      Files.deleteIfExists(dir.resolve(fileName(key)));
    } catch (IOException e) {
      throw StorageService.failed("delete", key, e);
    }
  }

  /** Legacy rows may hold an absolute path; only the filename is significant. */
  static String fileName(String key) {
    int slash = Math.max(key.lastIndexOf('/'), key.lastIndexOf('\\'));
    return slash < 0 ? key : key.substring(slash + 1);
  }
}
