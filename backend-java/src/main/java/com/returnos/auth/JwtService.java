package com.returnos.auth;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import javax.crypto.SecretKey;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service public class JwtService {
  private final SecretKey key; private final long expirationDays;
  JwtService(@Value("${returnos.jwt-secret}") String secret, @Value("${returnos.jwt-expiration-days}") long expirationDays) {
    if (secret == null || secret.length() < 32) throw new IllegalStateException("JWT_SECRET must be at least 32 characters");
    this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8)); this.expirationDays = expirationDays;
  }
  public String issue(String id, String email, String role) {
    var now = Instant.now(); return Jwts.builder().subject(id).claim("email", email).claim("role", role).issuedAt(Date.from(now)).expiration(Date.from(now.plus(expirationDays, ChronoUnit.DAYS))).signWith(key).compact();
  }
  public String subject(String token) { return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload().getSubject(); }
}
