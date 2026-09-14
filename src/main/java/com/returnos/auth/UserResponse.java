package com.returnos.auth;

import com.returnos.user.Role;
import com.returnos.user.User;
import java.util.UUID;

public record UserResponse(UUID id, String email, String fullName, Role role, boolean enabled) {
    public static UserResponse from(User user) {
        return new UserResponse(user.getId(), user.getEmail(), user.getFullName(), user.getRole(), user.isEnabled());
    }
}
