package com.returnos.storage;

import java.nio.file.Path;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

@Configuration public class StorageConfig {
  @Bean @ConditionalOnProperty(name = "returnos.storage-provider", havingValue = "s3") StorageService s3Storage(
      @Value("${returnos.aws-region}") String region, @Value("${returnos.aws-s3-bucket}") String bucket) {
    var credentials = DefaultCredentialsProvider.create();
    var s3 = S3Client.builder().region(Region.of(region)).credentialsProvider(credentials).build();
    var presigner = S3Presigner.builder().region(Region.of(region)).credentialsProvider(credentials).build();
    return new S3StorageService(s3, presigner, bucket);
  }

  @Bean @ConditionalOnProperty(name = "returnos.storage-provider", havingValue = "local", matchIfMissing = true) StorageService localStorage(
      @Value("${returnos.upload-dir:${UPLOAD_DIR:./uploads}}") String dir) throws java.io.IOException {
    return new LocalStorageService(Path.of(dir));
  }
}
