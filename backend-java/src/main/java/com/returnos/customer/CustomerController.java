package com.returnos.customer;

import com.returnos.auth.CurrentUser;
import com.returnos.common.ApiException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/v1") public class CustomerController {
  private final JdbcTemplate jdbc; private final PasswordEncoder passwords;
  CustomerController(JdbcTemplate jdbc, PasswordEncoder passwords){this.jdbc=jdbc;this.passwords=passwords;}
  record AddressCreate(@Size(max=60) String label,@NotBlank @Size(min=2,max=120) String fullName,@NotBlank @Size(min=2,max=200) String line1,@Size(max=200) String line2,@NotBlank @Size(min=2,max=100) String city,@NotBlank @Size(min=2,max=100) String state,@NotBlank @Size(min=3,max=20) String postalCode,@Size(min=2,max=60) String country,@Size(min=6,max=20) String phone,Boolean isDefault){}
  record AddressPatch(@Size(max=60) String label,@Size(min=2,max=120) String fullName,@Size(min=2,max=200) String line1,@Size(max=200) String line2,@Size(min=2,max=100) String city,@Size(min=2,max=100) String state,@Size(min=3,max=20) String postalCode,@Size(min=2,max=60) String country,@Size(min=6,max=20) String phone,Boolean isDefault){}
  record Profile(@Size(min=2,max=120) String fullName,@Size(min=6,max=20) String phone){} record Preferences(Map<String,Object> commPrefs,Map<String,Object> notifPrefs){} record PasswordChange(@NotBlank String currentPassword,@Size(min=6,max=100) String newPassword){}
  private void customer(CurrentUser u){if(u==null)throw new ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHORIZED","Authentication required");if(!"CUSTOMER".equals(u.role()))throw new ApiException(HttpStatus.FORBIDDEN,"FORBIDDEN","Customer access required");}
  static final String ADDR_COLS="id,user_id,label,full_name,line1,line2,city,state,postal_code,country,phone,is_default::int as is_default,created_at,updated_at";
  @GetMapping("/addresses") Map<String,Object> list(@AuthenticationPrincipal CurrentUser u){customer(u);return Map.of("addresses",jdbc.query("select "+ADDR_COLS+" from addresses where user_id=? order by is_default desc,created_at asc",(rs,n)->map(rs),u.id()));}
  @PostMapping("/addresses") @ResponseStatus(HttpStatus.CREATED) @Transactional Map<String,Object> create(@AuthenticationPrincipal CurrentUser u,@Valid @RequestBody AddressCreate b){customer(u);var id=UUID.randomUUID().toString();
    int existing=jdbc.queryForObject("select count(*) from addresses where user_id=?",Integer.class,u.id());
    boolean makeDefault=Boolean.TRUE.equals(b.isDefault())||existing==0;
    if(makeDefault)jdbc.update("update addresses set is_default=false where user_id=?",u.id());
    jdbc.update("insert into addresses(id,user_id,label,full_name,line1,line2,city,state,postal_code,country,phone,is_default) values(?,?,?,?,?,?,?,?,?,?,?,?)",id,u.id(),b.label(),b.fullName().trim(),b.line1(),b.line2(),b.city(),b.state(),b.postalCode(),b.country()==null?"IN":b.country(),b.phone(),makeDefault);return Map.of("address",address(u.id(),id));}
  @GetMapping("/addresses/{id}") Map<String,Object> get(@AuthenticationPrincipal CurrentUser u,@PathVariable String id){customer(u);return Map.of("address",address(u.id(),id));}
  @PatchMapping("/addresses/{id}") @Transactional Map<String,Object> update(@AuthenticationPrincipal CurrentUser u,@PathVariable String id,@Valid @RequestBody AddressPatch b){customer(u);address(u.id(),id);
    if(Boolean.TRUE.equals(b.isDefault()))jdbc.update("update addresses set is_default=false where user_id=?",u.id());
    jdbc.update("update addresses set label=coalesce(?,label),full_name=coalesce(?,full_name),line1=coalesce(?,line1),line2=coalesce(?,line2),city=coalesce(?,city),state=coalesce(?,state),postal_code=coalesce(?,postal_code),country=coalesce(?,country),phone=coalesce(?,phone),is_default=coalesce(?,is_default),updated_at=now() where id=? and user_id=?",b.label(),b.fullName(),b.line1(),b.line2(),b.city(),b.state(),b.postalCode(),b.country(),b.phone(),b.isDefault(),id,u.id());
    if(!jdbc.query("select is_default from addresses where id=?",(rs,n)->rs.getBoolean(1),id).getFirst()){
      if(jdbc.queryForObject("select count(*) from addresses where user_id=? and is_default=true and id!=?",Integer.class,u.id(),id)==0)jdbc.update("update addresses set is_default=true,updated_at=now() where id=?",id);
    }
    return Map.of("address",address(u.id(),id));}
  @DeleteMapping("/addresses/{id}") @Transactional Map<String,String> delete(@AuthenticationPrincipal CurrentUser u,@PathVariable String id){customer(u);
    var cur=jdbc.query("select is_default from addresses where id=? and user_id=?",(rs,n)->rs.getBoolean(1),id,u.id());
    if(cur.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"ADDRESS_NOT_FOUND","Address not found");
    jdbc.update("delete from addresses where id=? and user_id=?",id,u.id());
    if(cur.getFirst()){var oldest=jdbc.query("select id from addresses where user_id=? order by created_at asc limit 1",(rs,n)->rs.getString(1),u.id());if(!oldest.isEmpty())jdbc.update("update addresses set is_default=true,updated_at=now() where id=?",oldest.getFirst());}
    return Map.of("message","Address deleted");}
  void ensureProfile(String uid){jdbc.update("insert into customer_profiles(user_id,comm_prefs,notif_prefs) values(?,'{}'::jsonb,'{}'::jsonb) on conflict(user_id) do nothing",uid);}
  @GetMapping("/profile") Map<String,Object> profile(@AuthenticationPrincipal CurrentUser u){customer(u);ensureProfile(u.id());return profileResponse(u);}
  @PatchMapping("/profile") @Transactional Map<String,Object> profileUpdate(@AuthenticationPrincipal CurrentUser u,@Valid @RequestBody Profile b){customer(u);ensureProfile(u.id());if(b.fullName()!=null)jdbc.update("update users set full_name=? where id=?",b.fullName(),u.id());if(b.phone()!=null)jdbc.update("update customer_profiles set phone=? where user_id=?",b.phone(),u.id());return Map.of("user",Map.of("id",u.id(),"email",u.email(),"fullName",jdbc.queryForObject("select full_name from users where id=?",String.class,u.id()),"role",u.role()),"profile",jdbc.queryForMap("select * from customer_profiles where user_id=?",u.id()));}
  @PatchMapping("/profile/settings") @Transactional Map<String,Object> settings(@AuthenticationPrincipal CurrentUser u,@RequestBody(required=false) Preferences b){customer(u);ensureProfile(u.id());if(b==null)b=new Preferences(null,null);if(b.commPrefs()!=null)jdbc.update("update customer_profiles set comm_prefs=cast(? as jsonb) where user_id=?",json(checkedPrefs(b.commPrefs())),u.id());if(b.notifPrefs()!=null)jdbc.update("update customer_profiles set notif_prefs=cast(? as jsonb) where user_id=?",json(checkedPrefs(b.notifPrefs())),u.id());return Map.of("profile",parsedProfile(u.id()));}
  static Map<String,Boolean> checkedPrefs(Map<String,Object> prefs){var out=new LinkedHashMap<String,Boolean>();for(var e:prefs.entrySet()){if(!(e.getValue() instanceof Boolean v))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Request validation failed");out.put(e.getKey(),v);}return out;}
  @PostMapping("/profile/change-password") @Transactional Map<String,String> changePassword(@AuthenticationPrincipal CurrentUser u,@Valid @RequestBody PasswordChange b){customer(u);if(b.currentPassword().equals(b.newPassword()))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Request validation failed");var hash=jdbc.queryForObject("select password_hash from users where id=?",String.class,u.id());if(!passwords.matches(b.currentPassword(),hash))throw new ApiException(HttpStatus.UNAUTHORIZED,"INVALID_CREDENTIALS","Current password is incorrect");jdbc.update("update users set password_hash=? where id=?",passwords.encode(b.newPassword()),u.id());return Map.of("message","Password changed successfully");}
  @GetMapping("/credit") Map<String,Object> credit(@AuthenticationPrincipal CurrentUser u){customer(u);var balance=jdbc.queryForObject("select coalesce(sum(amount_paise),0) from store_credit_ledger where user_id=?",Integer.class,u.id());return Map.of("balancePaise",balance,"history",jdbc.query("select id,user_id,type,amount_paise,amount_paise as \"amountPaise\",reason,reference_type,reference_type as \"referenceType\",reference_id,reference_id as \"referenceId\",created_at,created_at as \"createdAt\" from store_credit_ledger where user_id=? order by created_at desc",(rs,n)->map(rs),u.id()));}
  private Map<String,Object> profileResponse(CurrentUser u){return Map.of("user",Map.of("id",u.id(),"email",u.email(),"fullName",jdbc.queryForObject("select full_name from users where id=?",String.class,u.id()),"role",u.role()),"profile",parsedProfile(u.id()));}
  private Map<String,Object> parsedProfile(String uid){var row=jdbc.queryForMap("select * from customer_profiles where user_id=?",uid);var out=new LinkedHashMap<String,Object>(row);out.put("commPrefs",parsePrefs(String.valueOf(row.get("comm_prefs"))));out.put("notifPrefs",parsePrefs(String.valueOf(row.get("notif_prefs"))));return out;}
  static Map<String,Boolean> parsePrefs(String raw){var out=new LinkedHashMap<String,Boolean>();try{var m=new com.fasterxml.jackson.databind.ObjectMapper().readValue(raw,Map.class);for(var e:m.entrySet())if(((Map.Entry<?,?>)e).getValue() instanceof Boolean v)out.put(String.valueOf(((Map.Entry<?,?>)e).getKey()),v);}catch(Exception e){}return out;}
  private Map<String,Object> address(String uid,String id){var r=jdbc.query("select "+ADDR_COLS+" from addresses where id=? and user_id=?",(rs,n)->map(rs),id,uid);if(r.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"ADDRESS_NOT_FOUND","Address not found");return r.getFirst();}
  private static Map<String,Object> map(java.sql.ResultSet r)throws java.sql.SQLException{var out=new LinkedHashMap<String,Object>();var md=r.getMetaData();for(int i=1;i<=md.getColumnCount();i++)out.put(md.getColumnLabel(i),r.getObject(i));return out;} private static String json(Map<String,Boolean> x){if(x==null)return "{}";return "{"+x.entrySet().stream().map(e->"\""+e.getKey().replace("\"","\\\"")+"\":"+e.getValue()).collect(java.util.stream.Collectors.joining(","))+"}";}
}
