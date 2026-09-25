package com.returnos.common;

import org.springframework.http.HttpStatus;

public class ApiException extends RuntimeException {
  private final HttpStatus status; private final String code; private final Object errors;
  public ApiException(HttpStatus status, String code, String message) { this(status, code, message, null); }
  public ApiException(HttpStatus status, String code, String message, Object errors) {
    super(message); this.status = status; this.code = code; this.errors = errors;
  }
  public HttpStatus status() { return status; } public String code() { return code; } public Object errors() { return errors; }
}
