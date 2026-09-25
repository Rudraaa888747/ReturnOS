package com.returnos.auth;

import com.returnos.common.ApiException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.stereotype.Component;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.OncePerRequestFilter;

@Configuration public class SecurityConfig {
  @Bean PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(); }
  @Bean SecurityFilterChain security(HttpSecurity http, JwtFilter jwt) throws Exception {
    return http.csrf(c -> c.disable()).cors(c -> {}).sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
      .exceptionHandling(e -> e.authenticationEntryPoint((request, response, ex) -> {
        // Mirrors TS requireAuth: unauthenticated access to protected routes is 401, not 403.
        response.setStatus(401); response.setContentType("application/json");
        response.getWriter().write("{\"code\":\"UNAUTHORIZED\",\"message\":\"Authentication required\"}");
      }))
      .authorizeHttpRequests(a -> a.requestMatchers("/api/health", "/api/v1/auth/**", "/api/v1/meta/**").permitAll().anyRequest().authenticated())
      .addFilterBefore(jwt, UsernamePasswordAuthenticationFilter.class).build();
  }
  @Bean CorsConfigurationSource cors(@org.springframework.beans.factory.annotation.Value("${returnos.cors-origins}") String origins) {
    var c = new CorsConfiguration(); c.setAllowedOrigins(List.of(origins.split(","))); c.setAllowedMethods(List.of("GET","POST","PUT","PATCH","DELETE","OPTIONS")); c.setAllowedHeaders(List.of("Authorization","Content-Type","Idempotency-Key")); c.setAllowCredentials(true);
    var source = new UrlBasedCorsConfigurationSource(); source.registerCorsConfiguration("/**", c); return source;
  }
}

@Component class JwtFilter extends OncePerRequestFilter {
  private final JwtService jwt; private final JdbcTemplate jdbc;
  JwtFilter(JwtService jwt, JdbcTemplate jdbc) { this.jwt = jwt; this.jdbc = jdbc; }
  @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws IOException, jakarta.servlet.ServletException {
    var header = request.getHeader("Authorization");
    if (header == null || !header.startsWith("Bearer ")) { chain.doFilter(request, response); return; }
    try {
      var id = jwt.subject(header.substring(7).trim());
      var users = jdbc.query("select id,email,role,active,warehouse_id from users where id=?", (rs, n) -> new CurrentUser(rs.getString("id"),rs.getString("email"),rs.getString("role"),rs.getString("warehouse_id")), id);
      if (users.isEmpty() || !jdbc.queryForObject("select active from users where id=?", Boolean.class, id)) throw new ApiException(HttpStatus.FORBIDDEN,"ACCOUNT_DISABLED","This account has been disabled");
      var user = users.getFirst(); var auth = new UsernamePasswordAuthenticationToken(user, null, List.of(new SimpleGrantedAuthority("ROLE_" + user.role()))); org.springframework.security.core.context.SecurityContextHolder.getContext().setAuthentication(auth);
    } catch (ApiException e) { response.setStatus(e.status().value()); response.setContentType("application/json"); response.getWriter().write("{\"code\":\"" + e.code() + "\",\"message\":\"" + e.getMessage() + "\"}"); return;
    } catch (Exception e) {
      // Invalid token: continue anonymous like TS routes without requireAuth
      // (public endpoints ignore tokens). Protected endpoints still 401 via
      // the entry point above, matching TS requireAuth.
      org.springframework.security.core.context.SecurityContextHolder.clearContext();
      chain.doFilter(request, response); return;
    }
    chain.doFilter(request,response);
  }
}
