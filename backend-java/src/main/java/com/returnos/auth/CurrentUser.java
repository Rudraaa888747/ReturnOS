package com.returnos.auth;

public record CurrentUser(String id, String email, String role, String warehouseId) {}
