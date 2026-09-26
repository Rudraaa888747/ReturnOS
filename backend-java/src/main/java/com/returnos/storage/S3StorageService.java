package com.returnos.storage;

import java.net.URI;
import java.time.Duration;
import java.util.Optional;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

/** Private-bucket S3 provider. Credentials come only from the SDK default
 * chain (environment), never from config files or code. */
public class S3StorageService implements StorageService {
  static final Duration PRESIGN_TTL = Duration.ofMinutes(5);

  private final S3Client s3;
  private final S3Presigner presigner;
  private final String bucket;

  public S3StorageService(S3Client s3, S3Presigner presigner, String bucket) {
    if (bucket == null || bucket.isBlank()) throw new IllegalStateException("AWS_S3_BUCKET must be set when returnos.storage-provider=s3");
    this.s3 = s3;
    this.presigner = presigner;
    this.bucket = bucket;
  }

  @Override public void store(String key, byte[] bytes, String mime) {
    StorageService.requireKey(key);
    try {
      s3.putObject(PutObjectRequest.builder().bucket(bucket).key(key).contentType(mime).contentLength((long) bytes.length).build(), RequestBody.fromBytes(bytes));
    } catch (S3Exception e) {
      throw StorageService.failed("upload", key, e);
    }
  }

  @Override public byte[] load(String key) {
    StorageService.requireKey(key);
    try (ResponseInputStream<GetObjectResponse> in = s3.getObject(GetObjectRequest.builder().bucket(bucket).key(key).build())) {
      return in.readAllBytes();
    } catch (NoSuchKeyException e) {
      throw StorageService.missing();
    } catch (S3Exception e) {
      if (e.statusCode() == 404 || "NoSuchKey".equals(e.awsErrorDetails() != null ? e.awsErrorDetails().errorCode() : null)) throw StorageService.missing();
      throw StorageService.failed("download", key, e);
    } catch (java.io.IOException e) {
      throw StorageService.failed("download", key, e);
    }
  }

  @Override public void delete(String key) {
    StorageService.requireKey(key);
    try {
      s3.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build());
    } catch (S3Exception e) {
      throw StorageService.failed("delete", key, e);
    }
  }

  /** Short-lived GET URL (private bucket stays private). Safe filename: the
   * original name is only ever a Content-Disposition hint, never the key. */
  @Override public Optional<URI> presignedDownload(String key, String filename, String mime) {
    StorageService.requireKey(key);
    String safe = filename == null ? "download" : filename.replaceAll("[\"\\\\\\r\\n]", "_");
    if (safe.isBlank()) safe = "download";
    try {
      var get = GetObjectRequest.builder().bucket(bucket).key(key)
        .responseContentType(mime).responseContentDisposition("attachment; filename=\"" + safe + "\"").build();
      var presigned = presigner.presignGetObject(GetObjectPresignRequest.builder().getObjectRequest(get).signatureDuration(PRESIGN_TTL).build());
      return Optional.of(presigned.url().toURI());
    } catch (S3Exception e) {
      throw StorageService.failed("presign", key, e);
    } catch (java.net.URISyntaxException e) {
      throw StorageService.failed("presign", key, e);
    }
  }
}
