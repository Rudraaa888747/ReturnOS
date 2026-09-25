package com.returnos.common;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {
  @ExceptionHandler(ApiException.class) ResponseEntity<Map<String,Object>> api(ApiException e) {
    var body = new LinkedHashMap<String,Object>(); body.put("code", e.code()); body.put("message", e.getMessage());
    if (e.errors() != null) body.put("errors", e.errors()); return ResponseEntity.status(e.status()).body(body);
  }
  @ExceptionHandler(MethodArgumentNotValidException.class) ResponseEntity<Map<String,Object>> validation(MethodArgumentNotValidException e) {
    var errors = e.getBindingResult().getFieldErrors().stream().map(x -> Map.of("field", x.getField(), "message", x.getDefaultMessage())).toList();
    return ResponseEntity.badRequest().body(Map.of("code", "VALIDATION_ERROR", "message", "Request validation failed", "errors", errors));
  }
  private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(ApiExceptionHandler.class);
  @ExceptionHandler(Exception.class) ResponseEntity<Map<String,Object>> unexpected(Exception e) {
    log.error("Unhandled error", e);
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("code", "INTERNAL_ERROR", "message", "An unexpected error occurred"));
  }
}
