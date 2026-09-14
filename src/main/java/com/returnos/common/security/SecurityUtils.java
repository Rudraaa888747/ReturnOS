package com.returnos.common.security;

import com.returnos.auth.UserPrincipal;
import com.returnos.common.exception.ResourceNotFoundException;
import com.returnos.user.User;
import com.returnos.user.UserRepository;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

@Component
public class SecurityUtils {

    private final UserRepository users;

    public SecurityUtils(UserRepository users) {
        this.users = users;
    }

    public UserPrincipal currentPrincipal() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof UserPrincipal principal) {
            return principal;
        }
        throw new ResourceNotFoundException("AUTH_REQUIRED", "No authenticated user");
    }

    public User currentUser() {
        UserPrincipal principal = currentPrincipal();
        return users.findById(principal.getId())
                .orElseThrow(() -> new ResourceNotFoundException("USER_NOT_FOUND", "Authenticated user not found"));
    }

    public UUID currentUserId() {
        return currentPrincipal().getId();
    }
}
