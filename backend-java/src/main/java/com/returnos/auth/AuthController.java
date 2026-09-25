package com.returnos.auth;

import com.returnos.common.ApiException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/v1/auth") public class AuthController {
  private final JdbcTemplate jdbc; private final PasswordEncoder passwords; private final JwtService jwt; private final org.springframework.core.env.Environment env;
  AuthController(JdbcTemplate jdbc, PasswordEncoder passwords, JwtService jwt, org.springframework.core.env.Environment env) { this.jdbc=jdbc; this.passwords=passwords; this.jwt=jwt; this.env=env; }
  record Signup(@Email String email, @Size(min=6,max=100) String password, @Size(min=2,max=120) String fullName) {}
  record Login(@Email String email, @NotBlank String password) {}
  record Forgot(@Email String email) {} record Reset(@Size(min=10) String token, @Size(min=6,max=100) String newPassword) {}
  @PostMapping("/signup") @ResponseStatus(HttpStatus.CREATED) Map<String,Object> signup(@Valid @RequestBody Signup body) {
    var email=body.email().trim().toLowerCase(); if (count("select count(*) from users where email=?", email)>0) throw new ApiException(HttpStatus.CONFLICT,"EMAIL_EXISTS","An account with this email already exists");
    var id=UUID.randomUUID().toString(); jdbc.update("insert into users(id,email,password_hash,full_name,role,active,created_at) values(?,?,? ,?,'CUSTOMER',true,now())",id,email,passwords.encode(body.password()),body.fullName().trim()); jdbc.update("insert into customer_profiles(user_id,comm_prefs,notif_prefs) values(?, '{}'::jsonb, '{}'::jsonb)",id);
    return session(id,email,body.fullName().trim(),"CUSTOMER");
  }
  @PostMapping("/login") Map<String,Object> login(@Valid @RequestBody Login body) {
    var rows=jdbc.query("select id,email,password_hash,full_name,role,active from users where email=?",(rs,n)->Map.of("id",rs.getString(1),"email",rs.getString(2),"hash",rs.getString(3),"name",rs.getString(4),"role",rs.getString(5),"active",rs.getBoolean(6)),body.email().trim().toLowerCase());
    if(rows.isEmpty() || !passwords.matches(body.password(),(String)rows.getFirst().get("hash"))) throw new ApiException(HttpStatus.UNAUTHORIZED,"INVALID_CREDENTIALS","Invalid email or password"); var user=rows.getFirst(); if(!(Boolean)user.get("active")) throw new ApiException(HttpStatus.FORBIDDEN,"ACCOUNT_DISABLED","This account has been disabled"); return session((String)user.get("id"),(String)user.get("email"),(String)user.get("name"),(String)user.get("role"));
  }
  @PostMapping("/forgot") Map<String,Object> forgot(@Valid @RequestBody Forgot body) {
    var rows=jdbc.query("select id from users where email=?",(rs,n)->rs.getString(1),body.email().trim().toLowerCase()); if(rows.isEmpty()) return Map.of("message","If the email exists, a reset link was created");
    var raw=randomToken(); jdbc.update("insert into password_resets(id,user_id,token_hash,expires_at,created_at) values(?,?,?,now()+interval '1 hour',now())",UUID.randomUUID().toString(),rows.getFirst(),passwords.encode(raw));
    // Mirror TS: token returned only outside production (tests/dev complete flow without SMTP).
    if(java.util.Arrays.asList(env.getActiveProfiles()).contains("prod")||java.util.Arrays.asList(env.getActiveProfiles()).contains("production")) return Map.of("message","If the email exists, a reset link was created");
    return Map.of("message","If the email exists, a reset link was created", "resetToken", raw);
  }
  @PostMapping("/reset") Map<String,String> reset(@Valid @RequestBody Reset body) {
    var rows=jdbc.query("select id,user_id,token_hash from password_resets where used_at is null and expires_at > now() order by created_at desc",(rs,n)->Map.of("id",rs.getString(1),"user",rs.getString(2),"hash",rs.getString(3))); var match=rows.stream().filter(x->passwords.matches(body.token(),(String)x.get("hash"))).findFirst().orElseThrow(()->new ApiException(HttpStatus.BAD_REQUEST,"INVALID_TOKEN","Reset token is invalid or expired")); jdbc.update("update password_resets set used_at=now() where id=?",match.get("id")); jdbc.update("update users set password_hash=? where id=?",passwords.encode(body.newPassword()),match.get("user")); return Map.of("message","Password was reset successfully");
  }
  @GetMapping("/me") Map<String,Object> me(@AuthenticationPrincipal CurrentUser user) { jdbc.update("insert into customer_profiles(user_id,comm_prefs,notif_prefs) values(?,'{}'::jsonb,'{}'::jsonb) on conflict(user_id) do nothing",user.id()); var p=jdbc.queryForMap("select * from customer_profiles where user_id=?",user.id()); return Map.of("user",Map.of("id",user.id(),"email",user.email(),"fullName",name(user.id()),"role",user.role()),"profile",p); }
  private Map<String,Object> session(String id,String email,String fullName,String role){return Map.of("user",Map.of("id",id,"email",email,"fullName",fullName,"role",role),"token",jwt.issue(id,email,role));} private String name(String id){return jdbc.queryForObject("select full_name from users where id=?",String.class,id);} private int count(String sql,Object v){return jdbc.queryForObject(sql,Integer.class,v);} private String randomToken(){byte[] b=new byte[32];new SecureRandom().nextBytes(b);return Base64.getUrlEncoder().withoutPadding().encodeToString(b);}
}
