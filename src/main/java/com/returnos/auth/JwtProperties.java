package com.returnos.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "returnos.jwt")
public record JwtProperties(String secret, long expirationMs) {}
