package com.returnos.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.returnos.common.ApiException;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

class StorageServiceTest {
  @Test void keyUsesSafeGeneratedNames(@TempDir Path tmp) {
    String key = StorageService.keyFor("ret-1", ".pdf");
    assertThat(key).matches("returns/ret-1/photos/\\d+-[0-9a-f-]+\\.pdf");
    assertThat(StorageService.keyFor("../../etc", ".pdf")).doesNotContain("..");
  }

  @Test void keysAreValidated() {
    assertThatThrownBy(() -> StorageService.requireKey("../evil")).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("INVALID_OBJECT_KEY"));
    assertThatThrownBy(() -> StorageService.requireKey(null)).isInstanceOf(ApiException.class);
  }

  @Test void localRoundTrip(@TempDir Path tmp) throws Exception {
    var local = new LocalStorageService(tmp);
    String key = StorageService.keyFor("r1", ".pdf");
    byte[] pdf = "%PDF-1.4 test".getBytes();
    local.store(key, pdf, "application/pdf");
    assertThat(local.load(key)).isEqualTo(pdf);
    local.delete(key);
    assertThatThrownBy(() -> local.load(key)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo("FILE_MISSING"));
    local.delete(key);
  }

  @Test void localReadsLegacyAbsolutePaths(@TempDir Path tmp) throws Exception {
    var local = new LocalStorageService(tmp);
    java.nio.file.Files.write(tmp.resolve("legacy.pdf"), new byte[] { 1, 2, 3 });
    assertThat(local.load(tmp.resolve("legacy.pdf").toString())).isEqualTo(new byte[] { 1, 2, 3 });
  }

  @Test void s3RequiresBucket() {
    var creds = StaticCredentialsProvider.create(AwsBasicCredentials.create("test", "test"));
    var s3 = S3Client.builder().region(Region.AP_SOUTH_1).credentialsProvider(creds).build();
    var presigner = S3Presigner.builder().region(Region.AP_SOUTH_1).credentialsProvider(creds).build();
    assertThatThrownBy(() -> new S3StorageService(s3, presigner, " ")).isInstanceOf(IllegalStateException.class);
    s3.close();
    presigner.close();
  }

  @Test void s3PresignsPrivateUrlsOffline() {
    var creds = StaticCredentialsProvider.create(AwsBasicCredentials.create("test", "test"));
    var s3 = S3Client.builder().region(Region.AP_SOUTH_1).credentialsProvider(creds).build();
    var presigner = S3Presigner.builder().region(Region.AP_SOUTH_1).credentialsProvider(creds).build();
    var svc = new S3StorageService(s3, presigner, "returnos");
    // Static test-only credentials: URL signing is pure HMAC, no network.
    var url = svc.presignedDownload("returns/r1/photos/a.pdf", "invoice \"1\".pdf", "application/pdf").orElseThrow();
    assertThat(url.getHost()).contains("returnos");
    assertThat(url.getPath()).contains("returns/r1/photos/a.pdf");
    assertThat(url.getQuery()).contains("X-Amz-Signature").contains("X-Amz-Expires=300");
    s3.close();
    presigner.close();
  }
}
