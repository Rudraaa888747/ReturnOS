package com.returnos.common.exception;

public class InvalidStateException extends RuntimeException {
    private final String code;

    public InvalidStateException(String message) {
        super(message);
        this.code = "INVALID_STATE";
    }

    public InvalidStateException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
