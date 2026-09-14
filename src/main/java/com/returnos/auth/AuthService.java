package com.returnos.auth;

import com.returnos.common.exception.BusinessException;
import com.returnos.user.Role;
import com.returnos.user.User;
import com.returnos.user.UserRepository;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final AuthenticationManager authenticationManager;

    public AuthService(
            UserRepository users,
            PasswordEncoder passwordEncoder,
            JwtService jwtService,
            AuthenticationManager authenticationManager) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.authenticationManager = authenticationManager;
    }

    @Transactional
    public AuthResponse register(RegisterRequest request) {
        String email = request.email().toLowerCase().trim();
        if (users.existsByEmail(email)) {
            throw new BusinessException("EMAIL_TAKEN", "Email is already registered");
        }
        User user = new User(email, passwordEncoder.encode(request.password()), request.fullName(), Role.CUSTOMER);
        users.save(user);
        String token = jwtService.generateToken(user.getEmail(), user.getRole().name(), user.getId().toString());
        return AuthResponse.bearer(token, UserResponse.from(user));
    }

    @Transactional
    public AuthResponse createUser(CreateUserRequest request) {
        String email = request.email().toLowerCase().trim();
        if (users.existsByEmail(email)) {
            throw new BusinessException("EMAIL_TAKEN", "Email is already registered");
        }
        User user =
                new User(email, passwordEncoder.encode(request.password()), request.fullName(), request.role());
        users.save(user);
        String token = jwtService.generateToken(user.getEmail(), user.getRole().name(), user.getId().toString());
        return AuthResponse.bearer(token, UserResponse.from(user));
    }

    @Transactional(readOnly = true)
    public AuthResponse login(LoginRequest request) {
        String email = request.email().toLowerCase().trim();
        Authentication auth = authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(email, request.password()));
        UserPrincipal principal = (UserPrincipal) auth.getPrincipal();
        User user = users.findByEmail(principal.getUsername())
                .orElseThrow(() -> new BusinessException("INVALID_CREDENTIALS", "Invalid email or password"));
        String token = jwtService.generateToken(user.getEmail(), user.getRole().name(), user.getId().toString());
        return AuthResponse.bearer(token, UserResponse.from(user));
    }
}
