package com.returnos.admin;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.returnos.auth.CurrentUser;
import com.returnos.common.ApiException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/v1/admin") public class AdminWritesController {
  private final JdbcTemplate jdbc; private final ObjectMapper json; private final PasswordEncoder passwords;
  AdminWritesController(JdbcTemplate jdbc,ObjectMapper json,PasswordEncoder passwords){this.jdbc=jdbc;this.json=json;this.passwords=passwords;}
  CurrentUser admin(CurrentUser u){
    if(u==null)throw new ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHORIZED","Authentication required");
    if(!"ADMIN".equals(u.role()))throw new ApiException(HttpStatus.FORBIDDEN,"ADMIN_REQUIRED","Admin access required");
    return u;
  }
  static void bad(boolean cond,String msg){if(cond)throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR",msg==null?"Request validation failed":msg);}
  static Map<String,Object> map(java.sql.ResultSet r)throws java.sql.SQLException{var x=new LinkedHashMap<String,Object>();var m=r.getMetaData();for(int i=1;i<=m.getColumnCount();i++)x.put(m.getColumnLabel(i),r.getObject(i));return x;}
  String jstr(Object v){try{if(v==null)return null;return json.writeValueAsString(v);}catch(Exception e){return null;}}
  void auditWrite(String actorId,String ip,String action,String entityType,String entityId,Object before,Object after,Object meta){
    jdbc.update("insert into admin_audit_log(id,actor_id,actor_role,action,entity_type,entity_id,previous_state,new_state,metadata,ip) values(?,?, 'ADMIN',?,?,?,?::jsonb,?::jsonb,?::jsonb,?)",UUID.randomUUID().toString(),actorId,action,entityType,entityId,jstr(before),jstr(after),jstr(meta),ip);
  }
  String ipOf(jakarta.servlet.http.HttpServletRequest req){return req==null?null:req.getRemoteAddr();}

  // ---- settings ----
  static final Map<String,String> SETTING_DESC=Map.of(
    "RETURN_WINDOW_DAYS","Days after delivery during which a return can be started.",
    "CHANGED_MIND_REFUND_DAYS","Days after delivery during which a change-of-mind return still offers a refund; afterwards store credit only.",
    "TASK_SLA_HOURS","Hours allowed per warehouse task kind before it counts as overdue. Applies to tasks created after the change.",
    "FREE_SHIPPING_THRESHOLD_PAISE","Basket subtotal in paise at or above which shipping is free.",
    "FLAT_SHIPPING_PAISE","Flat shipping fee in paise below the free-shipping threshold.");
  static final List<String> SLA_KEYS=List.of("RECEIVE_RETURN","INSPECT_ITEM","PROCESS_DISPOSITION","REVIEW_APPROVAL","RESTOCK","PACKAGE_REPLACEMENT","PREPARE_EXCHANGE","VERIFY_SHIPMENT");
  static Object defaultFor(String key, ObjectMapper json){
    try{
      return switch(key){
        case "RETURN_WINDOW_DAYS" -> 30;
        case "CHANGED_MIND_REFUND_DAYS" -> 14;
        case "TASK_SLA_HOURS" -> json.readValue("{\"RECEIVE_RETURN\":24,\"INSPECT_ITEM\":24,\"PROCESS_DISPOSITION\":48,\"REVIEW_APPROVAL\":8,\"RESTOCK\":24,\"PACKAGE_REPLACEMENT\":48,\"PREPARE_EXCHANGE\":48,\"VERIFY_SHIPMENT\":12}",Object.class);
        case "FREE_SHIPPING_THRESHOLD_PAISE" -> 299900;
        case "FLAT_SHIPPING_PAISE" -> 9900;
        default -> null;
      };
    }catch(Exception e){return null;}
  }
  Object validateSetting(String key,JsonNode value){
    bad(value==null||value.isNull(),"Invalid value for "+key);
    try{
      return switch(key){
        case "RETURN_WINDOW_DAYS" -> {int n=value.asInt(-999);bad(!value.isInt()||n<1||n>365,"Invalid value for "+key);yield n;}
        case "CHANGED_MIND_REFUND_DAYS" -> {int n=value.asInt(-999);bad(!value.isInt()||n<0||n>365,"Invalid value for "+key);yield n;}
        case "TASK_SLA_HOURS" -> {bad(!value.isObject(),"Invalid value for "+key);var m=new LinkedHashMap<String,Object>();for(String k:SLA_KEYS){var n=value.get(k);bad(n==null||!n.isInt()||n.asInt()<0||n.asInt()>720,"Invalid value for "+key);m.put(k,n.asInt());}yield m;}
        case "FREE_SHIPPING_THRESHOLD_PAISE", "FLAT_SHIPPING_PAISE" -> {int n=value.asInt(-1);bad(!value.isInt()||n<0||n>100_000_000,"Invalid value for "+key);yield n;}
        default -> throw new ApiException(HttpStatus.BAD_REQUEST,"UNKNOWN_SETTING","Unknown setting: "+key);
      };
    }catch(ApiException e){throw e;}
  }
  Map<String,Object> settingState(String key){
    var raw=jdbc.query("select value::text from settings where key=?",(r,n)->r.getString(1),key).stream().findFirst().orElse(null);
    Object parsed=null;boolean ok=false;
    if(raw!=null){try{Object v=json.readValue(raw,Object.class);Object checked=validateSetting(key,json.valueToTree(v));parsed=checked;ok=true;}catch(ApiException e){throw e;}catch(Exception e){ok=false;}}
    var out=new LinkedHashMap<String,Object>();out.put("key",key);out.put("description",SETTING_DESC.get(key));
    out.put("stored",ok?parsed:raw);out.put("effective",ok?parsed:defaultFor(key,json));out.put("valid",ok&&raw!=null||ok);out.put("default",defaultFor(key,json));
    if(raw==null){out.put("stored",null);out.put("valid",false);}
    return out;
  }
  @GetMapping("/settings") Map<String,Object> settings(@AuthenticationPrincipal CurrentUser u){admin(u);
    var list=new ArrayList<Map<String,Object>>();for(String k:SETTING_DESC.keySet())list.add(settingState(k));
    return Map.of("settings",list);}
  @PatchMapping("/settings/{key}") @Transactional Map<String,Object> setSetting(@AuthenticationPrincipal CurrentUser u,@PathVariable String key,@RequestBody(required=false) JsonNode body, jakarta.servlet.http.HttpServletRequest req){admin(u);
    if(!SETTING_DESC.containsKey(key))throw new ApiException(HttpStatus.BAD_REQUEST,"UNKNOWN_SETTING","Unknown setting: "+key);
    JsonNode value=body==null?null:body.get("value");
    Object valid=validateSetting(key,value);
    String before=jdbc.query("select value::text from settings where key=?",(r,n)->r.getString(1),key).stream().findFirst().orElse(null);
    String stored=jstr(valid);
    jdbc.update("insert into settings(key,value,updated_by,updated_at) values(?,?::jsonb,?,?) on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at",key,stored,u.id(),OffsetDateTime.now(ZoneOffset.UTC));
    auditWrite(u.id(),ipOf(req),"SETTING_UPDATED","SETTING",key,before,stored,null);
    return Map.of("setting",settingState(key));}

  // ---- return reasons ----
  @GetMapping("/return-reasons") Map<String,Object> reasons(@AuthenticationPrincipal CurrentUser u){admin(u);
    return Map.of("reasons",jdbc.query("select code,label,description,active::int as active,sort_order from return_reasons order by sort_order asc,label asc",(r,n)->map(r)));}
  record ReasonBody(@NotBlank @Size(max=40) String code,@NotBlank @Size(max=200) String label,@Size(max=2000) String description,Integer sortOrder){}
  record ReasonPatch(@Size(max=200) String label,@Size(max=2000) String description,Boolean active,Integer sortOrder){}
  @PostMapping("/return-reasons") @ResponseStatus(HttpStatus.CREATED) @Transactional Map<String,Object> createReason(@AuthenticationPrincipal CurrentUser u,@Valid @RequestBody ReasonBody b, jakarta.servlet.http.HttpServletRequest req){admin(u);
    if(b.sortOrder()!=null&&(b.sortOrder()<0||b.sortOrder()>1_000_000))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Request validation failed");
    String code=b.code().trim().toUpperCase();
    if(!code.matches("^[A-Z][A-Z0-9_]{1,39}$"))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Reason code must start with a letter and contain only A-Z, 0-9 and underscore");
    String label=b.label().trim();
    if(label.isEmpty())throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Reason label is required");
    if(!jdbc.query("select code from return_reasons where code=?",(r,n)->r.getString(1),code).isEmpty())throw new ApiException(HttpStatus.CONFLICT,"REASON_EXISTS","A return reason with code \""+code+"\" already exists");
    String desc=b.description()==null||b.description().trim().isEmpty()?null:b.description().trim();
    jdbc.update("insert into return_reasons(code,label,description,active,sort_order) values(?,?,?,true,?)",code,label,desc,b.sortOrder()==null?0:b.sortOrder());
    var row=jdbc.query("select code,label,description,active::int as active,sort_order from return_reasons where code=?",(r,n)->map(r),code).getFirst();
    auditWrite(u.id(),ipOf(req),"REASON_CREATED","REASON",code,null,row,null);
    return Map.of("reason",row);}
  @PatchMapping("/return-reasons/{code}") @Transactional Map<String,Object> updateReason(@AuthenticationPrincipal CurrentUser u,@PathVariable String code,@Valid @RequestBody ReasonPatch b, jakarta.servlet.http.HttpServletRequest req){admin(u);
    if(b.sortOrder()!=null&&(b.sortOrder()<0||b.sortOrder()>1_000_000))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Request validation failed");
    var before=jdbc.query("select code,label,description,active::int as active,sort_order from return_reasons where code=?",(r,n)->map(r),code);
    if(before.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"REASON_NOT_FOUND","Return reason not found");
    String label=before.getFirst().get("label").toString();Object desc=before.getFirst().get("description");
    boolean active=isActive(before.getFirst().get("active"));int sort=((Number)before.getFirst().get("sort_order")).intValue();
    if(b.label()!=null){String t=b.label().trim();if(t.isEmpty())throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Reason label is required");label=t;}
    if(b.description()!=null)desc=b.description().trim().isEmpty()?null:b.description().trim();
    if(b.active()!=null)active=b.active();
    if(b.sortOrder()!=null)sort=b.sortOrder();
    jdbc.update("update return_reasons set label=?,description=?,active=?,sort_order=? where code=?",label,desc,active,sort,code);
    var after=jdbc.query("select code,label,description,active::int as active,sort_order from return_reasons where code=?",(r,n)->map(r),code).getFirst();
    auditWrite(u.id(),ipOf(req),"REASON_UPDATED","REASON",code,before.getFirst(),after,null);
    return Map.of("reason",after);}

  // ---- store credit adjustments ----
  record CreditAdjust(@NotBlank @Size(max=80) String userId,String direction,@NotNull Integer amountPaise,@NotNull @Size(min=8,max=2000) String reason,@NotNull String key){}
  @PostMapping("/credit/adjustments") @Transactional org.springframework.http.ResponseEntity<Map<String,Object>> adjustCredit(@AuthenticationPrincipal CurrentUser u,@Valid @RequestBody CreditAdjust b, jakarta.servlet.http.HttpServletRequest req){admin(u);
    if(!Set.of("CREDIT","DEBIT").contains(b.direction()))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Request validation failed");
    if(b.amountPaise()<1||b.amountPaise()>100_000_000)throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Amount must be a positive integer number of paise");
    try{UUID.fromString(b.key());}catch(Exception e){throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Request validation failed");}
    var target=jdbc.query("select id,role from users where id=?",(r,n)->map(r),b.userId());
    if(target.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"USER_NOT_FOUND","User not found");
    if(!"CUSTOMER".equals(target.getFirst().get("role")))throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"CREDIT_USER_INVALID","Store credit adjustments apply to customer accounts only");
    String reason=b.reason().trim();
    if(reason.length()<8)throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","A justification reason of at least 8 characters is required");
    int before=jdbc.queryForObject("select coalesce(sum(amount_paise),0) from store_credit_ledger where user_id=?",Integer.class,b.userId());
    if("DEBIT".equals(b.direction())&&b.amountPaise()>before)throw new ApiException(HttpStatus.CONFLICT,"INSUFFICIENT_CREDIT","Balance "+before+" paise cannot cover a debit of "+b.amountPaise()+" paise");
    var prior=jdbc.query("select * from store_credit_ledger where reference_type='ADMIN_ADJUSTMENT' and reference_id=?",(r,n)->map(r),b.key());
    if(!prior.isEmpty()){var out=new LinkedHashMap<String,Object>();out.put("entry",prior.getFirst());out.put("balancePaise",before);out.put("replayed",true);return org.springframework.http.ResponseEntity.ok(out);}
    int signed="DEBIT".equals(b.direction())?-b.amountPaise():b.amountPaise();
    String eid=UUID.randomUUID().toString();
    jdbc.update("insert into store_credit_ledger(id,user_id,type,amount_paise,reason,reference_type,reference_id) values(?,?,?, ?,?,?,?) on conflict(reference_type,reference_id) do nothing",eid,b.userId(),b.direction(),signed,reason,"ADMIN_ADJUSTMENT",b.key());
    int after=before+signed;
    var meta=new LinkedHashMap<String,Object>();meta.put("direction",b.direction());meta.put("amountPaise",b.amountPaise());meta.put("key",b.key());meta.put("reason",reason);meta.put("userId",b.userId());
    auditWrite(u.id(),ipOf(req),"CREDIT_ADJUSTED","STORE_CREDIT",eid,Map.of("balancePaise",before),Map.of("balancePaise",after),meta);
    var out=new LinkedHashMap<String,Object>();out.put("entry",jdbc.query("select * from store_credit_ledger where id=?",(r,n)->map(r),eid).getFirst());out.put("balancePaise",after);out.put("replayed",false);return org.springframework.http.ResponseEntity.status(HttpStatus.CREATED).body(out);}

  // ---- warehouses & operators ----
  record WarehouseBody(@NotBlank @Size(max=40) String code,@NotBlank @Size(max=200) String name,@Size(max=200) String city,Boolean active){}
  record WarehousePatch(@Size(max=200) String name,@Size(max=200) String city,Boolean active){}
  record OperatorBody(@Email @Size(max=200) String email,@NotBlank @Size(min=8,max=200) String password,@NotBlank @Size(max=200) String fullName,@NotBlank @Size(max=80) String warehouseId){}
  record OperatorPatch(@Size(max=80) String warehouseId,Boolean active){}
  Map<String,Object> loadWarehouse(String id){var r=jdbc.query("select id,code,name,city,active::int as active,created_at,updated_at from warehouses where id=?",(x,n)->map(x),id);if(r.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"WAREHOUSE_NOT_FOUND","Warehouse not found");return r.getFirst();}
  @GetMapping("/warehouses/{id}") Map<String,Object> warehouseDetail(@AuthenticationPrincipal CurrentUser u,@PathVariable String id){admin(u);
    var w=loadWarehouse(id);
    var out=new LinkedHashMap<String,Object>(w);
    out.put("locations",jdbc.query("select id,code,name,kind,active::int as active from warehouse_locations where warehouse_id=? order by code asc",(r,n)->map(r),id));
    out.put("operators",jdbc.query("select id,email,full_name,active::int as active,created_at from users where warehouse_id=? and role='WAREHOUSE' order by created_at asc",(r,n)->map(r),id));
    out.put("recentReceiving",jdbc.query("select id,return_id,received_quantity,created_at from receiving_records where warehouse_id=? order by created_at desc limit 5",(r,n)->map(r),id));
    out.put("openTasks",jdbc.query("select id,title,kind,status,due_at from warehouse_tasks where warehouse_id=? and status in ('TODO','IN_PROGRESS') order by due_at asc limit 10",(r,n)->map(r),id));
    return out;}
  @PostMapping("/warehouses") @ResponseStatus(HttpStatus.CREATED) @Transactional Map<String,Object> createWarehouse(@AuthenticationPrincipal CurrentUser u,@Valid @RequestBody WarehouseBody b, jakarta.servlet.http.HttpServletRequest req){admin(u);
    String code=b.code().trim().toUpperCase();String name=b.name().trim();
    if(code.isEmpty()||name.isEmpty())throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Warehouse code and name are required");
    if(!jdbc.query("select id from warehouses where code=?",(r,n)->r.getString(1),code).isEmpty())throw new ApiException(HttpStatus.CONFLICT,"WAREHOUSE_CODE_EXISTS","A warehouse with code \""+code+"\" already exists");
    var t=OffsetDateTime.now(ZoneOffset.UTC);String id=UUID.randomUUID().toString();String city=b.city()==null?"":b.city().trim();
    jdbc.update("insert into warehouses(id,code,name,city,active,created_at,updated_at) values(?,?,?,?,?,?,?)",id,code,name,city,!(Boolean.FALSE.equals(b.active())),t,t);
    for(String[] loc:new String[][]{{"RECEIVING","Receiving dock"},{"INSPECTION","Inspection bench"},{"STOCK","Sellable stock"},{"DAMAGED","Damage hold"}})
      jdbc.update("insert into warehouse_locations(id,warehouse_id,code,name,kind,active,created_at) values(?,?,?,?,?,?,?) on conflict do nothing",UUID.randomUUID().toString(),id,code+"-"+loc[0],loc[1],loc[0],true,t);
    var row=loadWarehouse(id);
    auditWrite(u.id(),ipOf(req),"WAREHOUSE_CREATED","WAREHOUSE",id,null,row,null);
    return Map.of("warehouse",row);}
  @PatchMapping("/warehouses/{id}") @Transactional Map<String,Object> updateWarehouse(@AuthenticationPrincipal CurrentUser u,@PathVariable String id,@Valid @RequestBody WarehousePatch b, jakarta.servlet.http.HttpServletRequest req){admin(u);
    var before=loadWarehouse(id);
    String name=before.get("name").toString();String city=before.get("city")==null?"":before.get("city").toString();boolean active=isActive(before.get("active"));
    if(b.name()!=null){String t=b.name().trim();if(t.isEmpty())throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Warehouse name is required");name=t;}
    if(b.city()!=null)city=b.city().trim();
    if(b.active()!=null){
      if(!b.active()&&active){
        int openTasks=jdbc.queryForObject("select count(*) from warehouse_tasks where warehouse_id=? and status in ('TODO','IN_PROGRESS')",Integer.class,id);
        int pending=jdbc.queryForObject("select count(*) from returns r join receiving_records rec on rec.return_id=r.id where rec.warehouse_id=? and r.status in ('RECEIVED','INSPECTION')",Integer.class,id);
        if(openTasks>0||pending>0){
          var titles=jdbc.query("select title from warehouse_tasks where warehouse_id=? and status in ('TODO','IN_PROGRESS') order by due_at asc limit 5",(r,n)->r.getString(1),id);
          var numbers=jdbc.query("select r.return_number from returns r join receiving_records rec on rec.return_id=r.id where rec.warehouse_id=? and r.status in ('RECEIVED','INSPECTION') order by r.created_at asc limit 5",(r,n)->r.getString(1),id);
          int ops=jdbc.queryForObject("select count(*) from users where warehouse_id=? and role='WAREHOUSE'",Integer.class,id);
          var detail=new LinkedHashMap<String,Object>();detail.put("openTasks",openTasks);detail.put("pendingReturns",pending);detail.put("taskTitles",titles);detail.put("returnNumbers",numbers);detail.put("operatorsAssigned",ops);
          throw new ApiException(HttpStatus.CONFLICT,"WAREHOUSE_HAS_OPEN_WORK","Warehouse \""+before.get("code")+"\" has "+openTasks+" open task(s) and "+pending+" pending return(s) and cannot be disabled",detail);
        }
        active=false;
      }else if(b.active())active=true;
    }
    var t=OffsetDateTime.now(ZoneOffset.UTC);
    jdbc.update("update warehouses set name=?,city=?,active=?,updated_at=? where id=?",name,city,active,t,id);
    var after=loadWarehouse(id);
    auditWrite(u.id(),ipOf(req),"WAREHOUSE_UPDATED","WAREHOUSE",id,before,after,null);
    return Map.of("warehouse",after);}
  Map<String,Object> loadOperator(String id){var r=jdbc.query("select id,email,full_name,role,warehouse_id,active::int as active,created_at from users where id=?",(x,n)->map(x),id);if(r.isEmpty()||!"WAREHOUSE".equals(r.getFirst().get("role")))throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"OPERATOR_INVALID_ROLE","Only warehouse operator accounts are managed here");return r.getFirst();}
  @PostMapping("/warehouse-users") @ResponseStatus(HttpStatus.CREATED) @Transactional Map<String,Object> createOperator(@AuthenticationPrincipal CurrentUser u,@Valid @RequestBody OperatorBody b, jakarta.servlet.http.HttpServletRequest req){admin(u);
    String email=b.email().toLowerCase().trim();
    if(!jdbc.query("select id from users where email=?",(r,n)->r.getString(1),email).isEmpty())throw new ApiException(HttpStatus.CONFLICT,"EMAIL_EXISTS","An account with this email already exists");
    var site=jdbc.query("select id,active from warehouses where id=?",(r,n)->map(r),b.warehouseId());
    if(site.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"WAREHOUSE_NOT_FOUND","Warehouse not found");
    if(!(isActive(site.getFirst().get("active"))))throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"WAREHOUSE_DISABLED","Operators cannot be assigned to a disabled warehouse");
    String fullName=b.fullName().trim();
    if(fullName.isEmpty())throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Operator name is required");
    var t=OffsetDateTime.now(ZoneOffset.UTC);String id=UUID.randomUUID().toString();
    jdbc.update("insert into users(id,email,password_hash,full_name,role,warehouse_id,active,created_at) values(?,?,?,?, 'WAREHOUSE',?,true,?)",id,email,passwords.encode(b.password()),fullName,b.warehouseId(),t);
    var row=loadOperator(id);
    auditWrite(u.id(),ipOf(req),"OPERATOR_CREATED","USER",id,null,row,null);
    return Map.of("user",row);}
  @PatchMapping("/warehouse-users/{id}") @Transactional Map<String,Object> updateOperator(@AuthenticationPrincipal CurrentUser u,@PathVariable String id,@Valid @RequestBody OperatorPatch b, jakarta.servlet.http.HttpServletRequest req){admin(u);
    var before=loadOperator(id);
    String warehouseId=(String)before.get("warehouse_id");boolean active=isActive(before.get("active"));
    if(b.warehouseId()!=null){
      var site=jdbc.query("select id,active from warehouses where id=?",(r,n)->map(r),b.warehouseId());
      if(site.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"WAREHOUSE_NOT_FOUND","Warehouse not found");
      if(!(isActive(site.getFirst().get("active"))))throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"WAREHOUSE_DISABLED","Operators cannot be assigned to a disabled warehouse");
      warehouseId=b.warehouseId();
    }
    if(b.active()!=null){
      if(!b.active()&&active){
        int tasks=jdbc.queryForObject("select count(*) from warehouse_tasks where assigned_to=? and status in ('TODO','IN_PROGRESS')",Integer.class,id);
        int rets=jdbc.queryForObject("select count(*) from returns r join receiving_records rec on rec.return_id=r.id where rec.received_by=? and r.status not in ('RESOLVED','CANCELLED','REJECTED')",Integer.class,id);
        if(tasks>0||rets>0){
          var titles=jdbc.query("select title from warehouse_tasks where assigned_to=? and status in ('TODO','IN_PROGRESS') order by due_at asc limit 5",(r,n)->r.getString(1),id);
          var numbers=jdbc.query("select r.return_number from returns r join receiving_records rec on rec.return_id=r.id where rec.received_by=? and r.status not in ('RESOLVED','CANCELLED','REJECTED') order by r.created_at asc limit 5",(r,n)->r.getString(1),id);
          var detail=new LinkedHashMap<String,Object>();detail.put("assignedOpenTasks",tasks);detail.put("receivedOpenReturns",rets);detail.put("taskTitles",titles);detail.put("returnNumbers",numbers);
          throw new ApiException(HttpStatus.CONFLICT,"OPERATOR_HAS_OPEN_WORK","Operator \""+before.get("email")+"\" holds "+tasks+" assigned task(s) and "+rets+" received return(s) still open",detail);
        }
        active=false;
      }else if(b.active())active=true;
    }
    jdbc.update("update users set warehouse_id=?,active=? where id=?",warehouseId,active,id);
    var after=loadOperator(id);
    auditWrite(u.id(),ipOf(req),"OPERATOR_UPDATED","USER",id,before,after,null);
    return Map.of("user",after);}

  // ---- admin users & customers ----
  record AdminUserBody(@Email @Size(max=200) String email,@NotBlank @Size(min=8,max=200) String password,@NotBlank @Size(max=200) String fullName){}
  record AdminUserPatch(@Size(max=200) String fullName,Boolean active,String role){}
  record CustomerPatch(@NotNull Boolean active){}
  @GetMapping("/users") Map<String,Object> users(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String search,@RequestParam(required=false) String role,@RequestParam(required=false) String active,@RequestParam(required=false) String limit,@RequestParam(required=false) String offset){admin(u);
    if(role!=null&&!Set.of("ADMIN","CUSTOMER","WAREHOUSE").contains(role))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid role");
    if(active!=null&&!Set.of("true","false").contains(active))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid active");
    var f=new ArrayList<String>();var params=new ArrayList<Object>();
    if(role!=null)f.add("u.role = '"+role+"'");
    else f.add("u.role = 'ADMIN'");
    if(active!=null){f.add("u.active = ?");params.add("true".equals(active));}
    if(opt(search,120)!=null&&!search.isBlank()){String t="%"+search.trim().toLowerCase()+"%";f.add("(lower(u.email) like ? or lower(u.full_name) like ?)");params.add(t);params.add(t);}
    String where="where "+String.join(" AND ",f);
    int total=jdbc.queryForObject("select count(*) from users u "+where,Integer.class,params.toArray());
    var p2=new ArrayList<Object>(params);p2.add(lim(limit));p2.add(off(offset));
    var out=new LinkedHashMap<String,Object>();out.put("users",jdbc.query("select u.id,u.email,u.full_name,u.role,u.active::int as active,u.created_at from users u "+where+" order by u.created_at desc limit ? offset ?",(r,n)->map(r),p2.toArray()));out.put("total",total);return out;}
  int lim(String v){if(v==null)return 25;int n=Integer.parseInt(v);if(n<1||n>100)throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid limit");return n;}
  int off(String v){if(v==null)return 0;int n=Integer.parseInt(v);if(n<0)throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid offset");return n;}
  String opt(String v,int max){if(v==null)return null;if(v.length()>max)throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Parameter too long");return v;}
  @PostMapping("/users") @ResponseStatus(HttpStatus.CREATED) @Transactional Map<String,Object> createAdminUser(@AuthenticationPrincipal CurrentUser u,@Valid @RequestBody AdminUserBody b, jakarta.servlet.http.HttpServletRequest req){admin(u);
    String email=b.email().toLowerCase().trim();
    String fullName=b.fullName().trim();
    if(fullName.isEmpty())throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Admin name is required");
    if(!jdbc.query("select id from users where email=?",(r,n)->r.getString(1),email).isEmpty())throw new ApiException(HttpStatus.CONFLICT,"EMAIL_EXISTS","An account with this email already exists");
    var t=OffsetDateTime.now(ZoneOffset.UTC);String id="u-admin-"+System.currentTimeMillis()+"-"+(int)(Math.random()*1_000_000);
    jdbc.update("insert into users(id,email,password_hash,full_name,role,warehouse_id,active,created_at) values(?,?,?, ?, 'ADMIN',null,true,?)",id,email,passwords.encode(b.password()),fullName,t);
    var row=jdbc.query("select id,email,full_name,role,active::int as active,created_at from users where id=?",(r,n)->map(r),id).getFirst();
    auditWrite(u.id(),ipOf(req),"ADMIN_CREATED","USER",id,null,row,null);
    return Map.of("user",row);}
  @PatchMapping("/users/{id}") @Transactional Map<String,Object> updateAdminUser(@AuthenticationPrincipal CurrentUser u,@PathVariable String id,@Valid @RequestBody AdminUserPatch b, jakarta.servlet.http.HttpServletRequest req){admin(u);
    if(b.role()!=null&&!Set.of("ADMIN","CUSTOMER").contains(b.role()))throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"ROLE_NOT_MANAGED","Admin accounts may only move between ADMIN and CUSTOMER");
    var target=jdbc.query("select id,email,full_name,role,active::int as active,created_at from users where id=?",(r,n)->map(r),id);
    if(target.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"USER_NOT_FOUND","User not found");
    var t0=target.getFirst();String tRole=(String)t0.get("role");boolean tActive=isActive(t0.get("active"));
    if(!"ADMIN".equals(tRole)&&!"CUSTOMER".equals(tRole))throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"ROLE_NOT_MANAGED","Only admin and customer accounts are managed here");
    if(Boolean.FALSE.equals(b.active())||(b.role()!=null&&!b.role().equals(tRole)))guardAccountChange(u.id(),id,tRole,tActive,b.active(),b.role());
    String fullName=b.fullName()==null?t0.get("full_name").toString():b.fullName().trim();
    if(fullName.isEmpty())throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Admin name is required");
    boolean active=b.active()==null?tActive:b.active();
    String role=b.role()==null?tRole:b.role();
    jdbc.update("update users set full_name=?,active=?,role=? where id=?",fullName,active,role,id);
    var after=jdbc.query("select id,email,full_name,role,active::int as active,created_at from users where id=?",(r,n)->map(r),id).getFirst();
    auditWrite(u.id(),ipOf(req),"ADMIN_UPDATED","USER",id,t0,after,null);
    return Map.of("user",after);}
  void guardAccountChange(String actorId,String targetId,String tRole,boolean tActive,Boolean active,String role){
    boolean demotes=role!=null&&!"ADMIN".equals(role)&&"ADMIN".equals(tRole);
    boolean disables=Boolean.FALSE.equals(active)&&tActive;
    if("ADMIN".equals(tRole)&&(disables||demotes)){
      if(targetId.equals(actorId))throw new ApiException(HttpStatus.FORBIDDEN,"ADMIN_SELF_LOCKOUT","An admin cannot disable or demote their own account");
      if(jdbc.queryForObject("select count(*) from users where role='ADMIN' and active=true and id!=?",Integer.class,targetId)==0)throw new ApiException(HttpStatus.FORBIDDEN,"LAST_ADMIN_REQUIRED","This is the last remaining active admin account and cannot be disabled or demoted");
    }
  }
  @PatchMapping("/customers/{id}") @Transactional Map<String,Object> setCustomerActive(@AuthenticationPrincipal CurrentUser u,@PathVariable String id,@Valid @RequestBody CustomerPatch b, jakarta.servlet.http.HttpServletRequest req){admin(u);
    var target=jdbc.query("select id,email,full_name,role,active::int as active,created_at from users where id=?",(r,n)->map(r),id);
    if(target.isEmpty()||!"CUSTOMER".equals(target.getFirst().get("role")))throw new ApiException(HttpStatus.NOT_FOUND,"CUSTOMER_NOT_FOUND","Customer not found");
    jdbc.update("update users set active=? where id=?",b.active(),id);
    var after=jdbc.query("select id,email,full_name,role,active::int as active,created_at from users where id=?",(r,n)->map(r),id).getFirst();
    auditWrite(u.id(),ipOf(req),b.active()?"CUSTOMER_ENABLED":"CUSTOMER_DISABLED","USER",id,target.getFirst(),after,null);
    return Map.of("user",after);}

  // ---- catalog ----
  record CategoryBody(@NotBlank @Size(max=120) String name,@Size(max=2000) String description,Integer sortOrder,Boolean active){}
  record CategoryPatch(@Size(max=120) String name,@Size(max=2000) String description,Integer sortOrder,Boolean active){}
  record ProductBody(@NotBlank @Size(max=80) String sku,@NotBlank @Size(max=200) String name,@Size(max=4000) String description,@Size(max=4000) String details,@NotNull Integer pricePaise,@Size(max=2000) String imageUrl,@NotNull Integer stock,@Size(max=80) String categoryId,Boolean active){}
  record ProductPatch(@Size(max=200) String name,@Size(max=4000) String description,@Size(max=4000) String details,@Size(max=2000) String imageUrl,Integer pricePaise,Integer stock,@Size(max=80) String categoryId,Boolean active){}
  @GetMapping("/categories") Map<String,Object> categories(@AuthenticationPrincipal CurrentUser u){admin(u);
    return Map.of("categories",jdbc.query("select c.id,c.name,c.description,c.sort_order,c.active::int as active,c.created_at,c.updated_at,(select count(*) from products p where p.category_id=c.id) as product_count from categories c order by c.sort_order asc,c.name asc",(r,n)->map(r)));}
  @GetMapping("/categories/{id}") Map<String,Object> category(@AuthenticationPrincipal CurrentUser u,@PathVariable String id){admin(u);
    var c=jdbc.query("select id,name,description,sort_order,active::int as active,created_at,updated_at from categories where id=?",(r,n)->map(r),id);
    if(c.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"CATEGORY_NOT_FOUND","Category not found");
    var out=new LinkedHashMap<String,Object>();out.put("category",c.getFirst());out.put("products",jdbc.query("select id,sku,name,active::int as active from products where category_id=? order by name asc",(r,n)->map(r),id));return out;}
  @PostMapping("/categories") @ResponseStatus(HttpStatus.CREATED) @Transactional Map<String,Object> createCategory(@AuthenticationPrincipal CurrentUser u,@Valid @RequestBody CategoryBody b, jakarta.servlet.http.HttpServletRequest req){admin(u);
    if(b.sortOrder()!=null&&(b.sortOrder()<0||b.sortOrder()>1_000_000))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Request validation failed");
    String name=b.name().trim();
    if(name.isEmpty())throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Category name is required");
    if(!jdbc.query("select id from categories where name=?",(r,n)->r.getString(1),name).isEmpty())throw new ApiException(HttpStatus.CONFLICT,"CATEGORY_NAME_EXISTS","A category named \""+name+"\" already exists");
    var t=OffsetDateTime.now(ZoneOffset.UTC);String id=UUID.randomUUID().toString();
    String desc=b.description()==null||b.description().trim().isEmpty()?null:b.description().trim();
    jdbc.update("insert into categories(id,name,description,sort_order,active,created_at,updated_at) values(?,?,?,?,?,?,?)",id,name,desc,b.sortOrder()==null?0:b.sortOrder(),!Boolean.FALSE.equals(b.active()),t,t);
    var row=jdbc.query("select id,name,description,sort_order,active::int as active,created_at,updated_at from categories where id=?",(r,n)->map(r),id).getFirst();
    auditWrite(u.id(),ipOf(req),"CATEGORY_CREATED","CATEGORY",id,null,row,null);
    return Map.of("category",row);}
  @PatchMapping("/categories/{id}") @Transactional Map<String,Object> updateCategory(@AuthenticationPrincipal CurrentUser u,@PathVariable String id,@Valid @RequestBody CategoryPatch b, jakarta.servlet.http.HttpServletRequest req){admin(u);
    if(b.sortOrder()!=null&&(b.sortOrder()<0||b.sortOrder()>1_000_000))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Request validation failed");
    var before=jdbc.query("select id,name,description,sort_order,active::int as active,created_at,updated_at from categories where id=?",(r,n)->map(r),id);
    if(before.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"CATEGORY_NOT_FOUND","Category not found");
    String name=before.getFirst().get("name").toString();Object desc=before.getFirst().get("description");
    int sort=((Number)before.getFirst().get("sort_order")).intValue();boolean active=isActive(before.getFirst().get("active"));
    if(b.name()!=null){String t=b.name().trim();if(t.isEmpty())throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Category name is required");
      if(!jdbc.query("select id from categories where name=? and id!=?",(r,n)->r.getString(1),t,id).isEmpty())throw new ApiException(HttpStatus.CONFLICT,"CATEGORY_NAME_EXISTS","A category named \""+t+"\" already exists");name=t;}
    if(b.description()!=null)desc=b.description().trim().isEmpty()?null:b.description().trim();
    if(b.sortOrder()!=null)sort=b.sortOrder();
    if(b.active()!=null)active=b.active();
    jdbc.update("update categories set name=?,description=?,sort_order=?,active=?,updated_at=? where id=?",name,desc,sort,active,OffsetDateTime.now(ZoneOffset.UTC),id);
    var after=jdbc.query("select id,name,description,sort_order,active::int as active,created_at,updated_at from categories where id=?",(r,n)->map(r),id).getFirst();
    auditWrite(u.id(),ipOf(req),"CATEGORY_UPDATED","CATEGORY",id,before.getFirst(),after,null);
    return Map.of("category",after);}
  @DeleteMapping("/categories/{id}") @ResponseStatus(HttpStatus.NO_CONTENT) @Transactional void deleteCategory(@AuthenticationPrincipal CurrentUser u,@PathVariable String id, jakarta.servlet.http.HttpServletRequest req){admin(u);
    var before=jdbc.query("select id,name,description,sort_order,active::int as active,created_at,updated_at from categories where id=?",(r,n)->map(r),id);
    if(before.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"CATEGORY_NOT_FOUND","Category not found");
    int count=jdbc.queryForObject("select count(*) from products where category_id=?",Integer.class,id);
    if(count>0){
      var skus=jdbc.query("select sku from products where category_id=? order by sku asc limit 6",(r,n)->r.getString(1),id);
      var detail=new LinkedHashMap<String,Object>();detail.put("count",count);detail.put("skus",skus);
      throw new ApiException(HttpStatus.CONFLICT,"CATEGORY_IN_USE","Category \""+before.getFirst().get("name")+"\" still holds "+count+" product(s) and cannot be deleted",detail);
    }
    jdbc.update("delete from categories where id=?",id);
    auditWrite(u.id(),ipOf(req),"CATEGORY_DELETED","CATEGORY",id,before.getFirst(),null,null);}
  static final Map<String,String> PRODUCT_SORTS=Map.of("name","p.name","price","p.price_paise","stock","p.stock","created_at","p.created_at","sku","p.sku");
  @GetMapping("/products") Map<String,Object> products(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String search,@RequestParam(required=false) String active,@RequestParam(required=false) String categoryId,@RequestParam(required=false) String sort,@RequestParam(required=false) String dir,@RequestParam(required=false) String limit,@RequestParam(required=false) String offset){admin(u);
    var f=new ArrayList<String>();var params=new ArrayList<Object>();
    if(opt(search,120)!=null&&!search.isBlank()){String t="%"+search.trim().toLowerCase()+"%";f.add("(lower(p.sku) like ? or lower(p.name) like ?)");params.add(t);params.add(t);}
    if(active!=null){if(!Set.of("true","false").contains(active))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid active");f.add("p.active = ?");params.add("true".equals(active));}
    if(opt(categoryId,80)!=null&&!categoryId.isBlank()){f.add("p.category_id = ?");params.add(categoryId);}
    String where=f.isEmpty()?"":"where "+String.join(" AND ",f);
    String orderBy=PRODUCT_SORTS.getOrDefault(sort==null?"name":sort,"p.name");
    String dd=dir==null?"ASC":("DESC".equalsIgnoreCase(dir)?"DESC":("ASC".equalsIgnoreCase(dir)?"ASC":"ASC"));
    int total=jdbc.queryForObject("select count(*) from products p "+where,Integer.class,params.toArray());
    var p2=new ArrayList<Object>(params);p2.add(lim(limit));p2.add(off(offset));
    var out=new LinkedHashMap<String,Object>();out.put("products",jdbc.query("select p.*,c.name as category_name,(select count(distinct o.id) from orders o join order_items oi on oi.order_id=o.id where oi.product_id=p.id and o.status not in ('DELIVERED','CANCELLED')) as open_orders,(select count(distinct r.id) from returns r join return_items ri on ri.return_id=r.id join order_items oi on oi.id=ri.order_item_id where oi.product_id=p.id and r.status not in ('RESOLVED','CANCELLED','REJECTED')) as open_returns from products p left join categories c on c.id=p.category_id "+where+" order by "+orderBy+" "+dd+" limit ? offset ?",(r,n)->map(r),p2.toArray()));out.put("total",total);return out;}
  @GetMapping("/products/{id}") Map<String,Object> product(@AuthenticationPrincipal CurrentUser u,@PathVariable String id){admin(u);
    var p=jdbc.query("select p.*,c.name as category_name,p.active::int as active from products p left join categories c on c.id=p.category_id where p.id=?",(r,n)->map(r),id);
    if(p.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"PRODUCT_NOT_FOUND","Product not found");
    var out=new LinkedHashMap<String,Object>();out.put("product",p.getFirst());
    out.put("buckets",jdbc.query("select warehouse_id,state,quantity from inventory_buckets where product_id=? order by state asc",(r,n)->map(r),id));
    out.put("movements",jdbc.query("select id,reason,quantity,from_state,to_state,created_at from inventory_movements where product_id=? order by created_at desc,id desc limit 10",(r,n)->map(r),id));
    out.put("openOrders",jdbc.query("select o.order_number,o.status from orders o join order_items oi on oi.order_id=o.id where oi.product_id=? and o.status not in ('DELIVERED','CANCELLED') group by o.order_number,o.status order by max(o.created_at) desc limit 5",(r,n)->map(r),id));
    out.put("openReturns",jdbc.query("select r.return_number,r.status from returns r join return_items ri on ri.return_id=r.id join order_items oi on oi.id=ri.order_item_id where oi.product_id=? and r.status not in ('RESOLVED','CANCELLED','REJECTED') group by r.return_number,r.status order by max(r.created_at) desc limit 5",(r,n)->map(r),id));
    return out;}
  @PostMapping("/products") @ResponseStatus(HttpStatus.CREATED) @Transactional Map<String,Object> createProduct(@AuthenticationPrincipal CurrentUser u,@Valid @RequestBody ProductBody b, jakarta.servlet.http.HttpServletRequest req){admin(u);
    String sku=b.sku().trim();String name=b.name().trim();
    if(sku.isEmpty()||name.isEmpty())throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","SKU and name are required");
    if(b.pricePaise()<0||b.pricePaise()>100_000_000||b.stock()<0||b.stock()>1_000_000)throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Request validation failed");
    if(!jdbc.query("select id from products where sku=?",(r,n)->r.getString(1),sku).isEmpty())throw new ApiException(HttpStatus.CONFLICT,"PRODUCT_SKU_EXISTS","A product with SKU \""+sku+"\" already exists");
    if(b.categoryId()!=null&&!b.categoryId().isBlank())requireActiveCategory(b.categoryId());
    var t=OffsetDateTime.now(ZoneOffset.UTC);String id=UUID.randomUUID().toString();
    jdbc.update("insert into products(id,sku,name,description,details,price_paise,image_url,stock,active,category_id,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?,?,?)",id,sku,name,b.description()==null?"":b.description(),b.details()==null?"":b.details(),b.pricePaise(),b.imageUrl()==null?"":b.imageUrl(),b.stock(),!Boolean.FALSE.equals(b.active()),blankToNull(b.categoryId()),t,t);
    mirrorStock(id,b.stock(),t);
    var after=jdbc.query("select p.*,c.name as category_name,p.active::int as active from products p left join categories c on c.id=p.category_id where p.id=?",(r,n)->map(r),id).getFirst();
    auditWrite(u.id(),ipOf(req),"PRODUCT_CREATED","PRODUCT",id,null,after,null);
    return Map.of("product",after);}
  void requireActiveCategory(String categoryId){var c=jdbc.query("select id,name,description,sort_order,active::int as active,created_at,updated_at from categories where id=?",(r,n)->map(r),categoryId);if(c.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"CATEGORY_NOT_FOUND","Category not found");if(!(isActive(c.getFirst().get("active"))))throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"CATEGORY_INACTIVE","Category \""+c.getFirst().get("name")+"\" is disabled and cannot take new products");}
  void mirrorStock(String productId,int stock,OffsetDateTime t){jdbc.update("insert into inventory_buckets(warehouse_id,product_id,state,quantity,location_id,updated_at) values(?,?, 'AVAILABLE',?,null,?) on conflict(warehouse_id,product_id,state) do update set quantity=excluded.quantity,updated_at=excluded.updated_at","wh-blr-01",productId,stock,t);}
  static String blankToNull(String s){return s==null||s.isBlank()?null:s;}
  static boolean isActive(Object v){return v instanceof Boolean b?b:v instanceof Number n?n.intValue()!=0:"true".equalsIgnoreCase(String.valueOf(v));}
  @PatchMapping("/products/{id}") @Transactional Map<String,Object> updateProduct(@AuthenticationPrincipal CurrentUser u,@PathVariable String id,@Valid @RequestBody ProductPatch b, jakarta.servlet.http.HttpServletRequest req){admin(u);
    var before=jdbc.query("select p.*,c.name as category_name,p.active::int as active from products p left join categories c on c.id=p.category_id where p.id=?",(r,n)->map(r),id);
    if(before.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"PRODUCT_NOT_FOUND","Product not found");
    var b0=before.getFirst();
    String name=b0.get("name").toString();String description=(String)b0.get("description");String details=(String)b0.get("details");String imageUrl=(String)b0.get("image_url");
    int price=((Number)b0.get("price_paise")).intValue();int stock=((Number)b0.get("stock")).intValue();String categoryId=(String)b0.get("category_id");boolean active=isActive(b0.get("active"));
    if(b.name()!=null){String t=b.name().trim();if(t.isEmpty())throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Product name is required");name=t;}
    if(b.description()!=null)description=b.description();
    if(b.details()!=null)details=b.details();
    if(b.imageUrl()!=null)imageUrl=b.imageUrl();
    if(b.pricePaise()!=null){if(b.pricePaise()<0||b.pricePaise()>100_000_000)throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Price must be a non-negative integer number of paise");price=b.pricePaise();}
    if(b.stock()!=null){if(b.stock()<0||b.stock()>1_000_000)throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Stock must be a non-negative integer");stock=b.stock();}
    if(b.categoryId()!=null){if(b.categoryId().isBlank())categoryId=null;else{requireActiveCategory(b.categoryId());categoryId=b.categoryId();}}
    if(b.active()!=null){
      if(!b.active()&&active){
        int openOrders=jdbc.queryForObject("select count(distinct o.id) from orders o join order_items oi on oi.order_id=o.id where oi.product_id=? and o.status not in ('DELIVERED','CANCELLED')",Integer.class,id);
        int openReturns=jdbc.queryForObject("select count(distinct r.id) from returns r join return_items ri on ri.return_id=r.id join order_items oi on oi.id=ri.order_item_id where oi.product_id=? and r.status not in ('RESOLVED','CANCELLED','REJECTED')",Integer.class,id);
        if(openOrders>0||openReturns>0){
          var orderNumbers=jdbc.query("select o.order_number from orders o join order_items oi on oi.order_id=o.id where oi.product_id=? and o.status not in ('DELIVERED','CANCELLED') group by o.order_number order by max(o.created_at) desc limit 5",(r,n)->r.getString(1),id);
          var returnNumbers=jdbc.query("select r.return_number from returns r join return_items ri on ri.return_id=r.id join order_items oi on oi.id=ri.order_item_id where oi.product_id=? and r.status not in ('RESOLVED','CANCELLED','REJECTED') group by r.return_number order by max(r.created_at) desc limit 5",(r,n)->r.getString(1),id);
          var detail=new LinkedHashMap<String,Object>();detail.put("openOrders",openOrders);detail.put("openReturns",openReturns);detail.put("orderNumbers",orderNumbers);detail.put("returnNumbers",returnNumbers);
          throw new ApiException(HttpStatus.CONFLICT,"PRODUCT_HAS_PENDING_TRANSACTIONS","Product \""+b0.get("sku")+"\" has "+openOrders+" open order(s) and "+openReturns+" open return(s) and cannot be disabled",detail);
        }
        active=false;
      }else if(b.active())active=true;
    }
    var t=OffsetDateTime.now(ZoneOffset.UTC);
    jdbc.update("update products set name=?,description=?,details=?,image_url=?,price_paise=?,stock=?,category_id=?,active=?,updated_at=? where id=?",name,description,details,imageUrl,price,stock,categoryId,active,t,id);
    if(b.stock()!=null)mirrorStock(id,stock,t);
    var after=jdbc.query("select p.*,c.name as category_name,p.active::int as active from products p left join categories c on c.id=p.category_id where p.id=?",(r,n)->map(r),id).getFirst();
    auditWrite(u.id(),ipOf(req),"PRODUCT_UPDATED","PRODUCT",id,b0,after,null);
    return Map.of("product",after);}

  // ---- support (admin) ----
  record TicketUpdate(String assignedTo,Boolean assignedSet,String status,String priority){}
  @GetMapping("/support/tickets") Map<String,Object> tickets(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String search,@RequestParam(required=false) String status,@RequestParam(required=false) String priority,@RequestParam(required=false) String assignedTo,@RequestParam(required=false) String customerId,@RequestParam(required=false) String limit,@RequestParam(required=false) String offset){admin(u);
    if(status!=null&&!Set.of("OPEN","CLOSED").contains(status))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid status");
    if(priority!=null&&!Set.of("LOW","NORMAL","HIGH","URGENT").contains(priority))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid priority");
    var f=new ArrayList<String>();var params=new ArrayList<Object>();
    if(opt(search,120)!=null&&!search.isBlank()){String t="%"+search.trim().toLowerCase()+"%";f.add("(lower(t.ticket_number) like ? or lower(t.subject) like ? or lower(u.email) like ?)");params.add(t);params.add(t);params.add(t);}
    if(status!=null){f.add("t.status = ?");params.add(status);}
    if(priority!=null){f.add("t.priority = ?");params.add(priority);}
    if(opt(assignedTo,80)!=null&&!assignedTo.isBlank()){f.add("t.assigned_to = ?");params.add(assignedTo);}
    if(opt(customerId,80)!=null&&!customerId.isBlank()){f.add("t.user_id = ?");params.add(customerId);}
    String where=f.isEmpty()?"":"where "+String.join(" AND ",f);
    String from="from support_tickets t join users u on u.id=t.user_id left join users a on a.id=t.assigned_to left join returns r on r.id=t.return_id";
    int total=jdbc.queryForObject("select count(*) "+from+" "+where,Integer.class,params.toArray());
    var p2=new ArrayList<Object>(params);p2.add(lim(limit));p2.add(off(offset));
    var out=new LinkedHashMap<String,Object>();out.put("tickets",jdbc.query("select t.id,t.ticket_number,t.user_id,u.email as customer_email,u.full_name as customer_name,t.return_id,r.return_number,t.subject,t.status,t.priority,t.assigned_to,a.email as assignee_email,t.created_at,t.updated_at "+from+" "+where+" order by t.updated_at desc limit ? offset ?",(r,n)->map(r),p2.toArray()));out.put("total",total);return out;}
  @GetMapping("/support/tickets/{id}") Map<String,Object> ticketDetail(@AuthenticationPrincipal CurrentUser u,@PathVariable String id){admin(u);
    var t=jdbc.query("select t.id,t.ticket_number,t.user_id,u.email as customer_email,u.full_name as customer_name,t.return_id,r.return_number,t.subject,t.status,t.priority,t.assigned_to,a.email as assignee_email,t.created_at,t.updated_at from support_tickets t join users u on u.id=t.user_id left join users a on a.id=t.assigned_to left join returns r on r.id=t.return_id where t.id=?",(r,n)->map(r),id);
    if(t.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"TICKET_NOT_FOUND","Support ticket not found");
    var out=new LinkedHashMap<String,Object>();out.put("ticket",t.getFirst());out.put("messages",jdbc.query("select id,author_role,body,created_at from support_messages where ticket_id=? order by created_at asc",(r,n)->map(r),id));return out;}
  @PatchMapping("/support/tickets/{id}") @Transactional Map<String,Object> ticketUpdate(@AuthenticationPrincipal CurrentUser u,@PathVariable String id,@RequestBody(required=false) com.fasterxml.jackson.databind.JsonNode b, jakarta.servlet.http.HttpServletRequest req){admin(u);
    var base=ticketDetail(u,id);
    Map<String,Object> ticket=new LinkedHashMap<String,Object>((Map<String,Object>)base.get("ticket"));var messages=base.get("messages");
    if(b!=null&&b.has("assignedTo")){
      var n=b.get("assignedTo");String assigned=n.isNull()?null:n.asText();
      if(assigned!=null){
        var who=jdbc.query("select id,role from users where id=?",(r,x)->map(r),assigned);
        if(who.isEmpty()||(!"ADMIN".equals(who.getFirst().get("role"))&&!"WAREHOUSE".equals(who.getFirst().get("role"))))throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"ASSIGNEE_INVALID","Tickets may only be assigned to admin or warehouse accounts");
      }
      var before=ticket.get("assigned_to");
      jdbc.update("update support_tickets set assigned_to=?,updated_at=? where id=?",assigned,OffsetDateTime.now(ZoneOffset.UTC),id);
      auditWrite(u.id(),ipOf(req),"TICKET_ASSIGNED","TICKET",id,Map.of("assigned_to",String.valueOf(before)),Map.of("assigned_to",String.valueOf(assigned)),null);
      Object refreshed=ticketDetail(u,id).get("ticket");if(refreshed instanceof Map)ticket=new LinkedHashMap<String,Object>((Map<String,Object>)refreshed);
    }
    if(b!=null&&b.has("status")&&!b.get("status").isNull()){
      String status=b.get("status").asText();
      if(!Set.of("OPEN","CLOSED").contains(status))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid status");
      var cur=ticket.get("status");
      jdbc.update("update support_tickets set status=?,updated_at=? where id=?",status,OffsetDateTime.now(ZoneOffset.UTC),id);
      auditWrite(u.id(),ipOf(req),"CLOSED".equals(status)?"TICKET_CLOSED":"TICKET_REOPENED","TICKET",id,Map.of("status",cur),Map.of("status",status),null);
      if("CLOSED".equals(status))notifyCustomer((String)ticket.get("user_id"),"TICKET_CLOSED",Map.of("ticket_number",(String)ticket.get("ticket_number")),"Ticket "+ticket.get("ticket_number")+" closed","Your support ticket \""+ticket.get("subject")+"\" was closed. Reply to reopen it.");
      ticket=(Map<String,Object>)ticketDetail(u,id).get("ticket");
    }
    if(b!=null&&b.has("priority")&&!b.get("priority").isNull()){
      String priority=b.get("priority").asText();
      if(!Set.of("LOW","NORMAL","HIGH","URGENT").contains(priority))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid priority");
      var cur=ticket.get("priority");
      jdbc.update("update support_tickets set priority=?,updated_at=? where id=?",priority,OffsetDateTime.now(ZoneOffset.UTC),id);
      auditWrite(u.id(),ipOf(req),"TICKET_PRIORITY_SET","TICKET",id,Map.of("priority",cur),Map.of("priority",priority),null);
      ticket=(Map<String,Object>)ticketDetail(u,id).get("ticket");
    }
    var out=new LinkedHashMap<String,Object>();out.put("ticket",ticket);out.put("messages",messages);return out;}
  record TicketReply(@NotBlank @Size(max=5000) String body){}
  @PostMapping("/support/tickets/{id}/messages") @ResponseStatus(HttpStatus.CREATED) @Transactional Map<String,Object> ticketReply(@AuthenticationPrincipal CurrentUser u,@PathVariable String id,@Valid @RequestBody TicketReply b, jakarta.servlet.http.HttpServletRequest req){admin(u);
    var t0=jdbc.query("select id,user_id,status from support_tickets where id=?",(r,n)->map(r),id);
    if(t0.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"TICKET_NOT_FOUND","Support ticket not found");
    if("CLOSED".equals(t0.getFirst().get("status")))throw new ApiException(HttpStatus.CONFLICT,"TICKET_CLOSED","Closed tickets cannot receive new messages");
    String text=b.body().trim();
    if(text.isEmpty())throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Reply body is required");
    var t=OffsetDateTime.now(ZoneOffset.UTC);String mid=UUID.randomUUID().toString();
    jdbc.update("insert into support_messages(id,ticket_id,author_role,body,created_at) values(?,?,'ADMIN',?,?)",mid,id,text,t);
    jdbc.update("update support_tickets set updated_at=? where id=?",t,id);
    auditWrite(u.id(),ipOf(req),"TICKET_REPLIED","TICKET",id,null,Map.of("message_id",mid),null);
    var num=jdbc.queryForObject("select ticket_number from support_tickets where id=?",String.class,id);
    notifyCustomer((String)t0.getFirst().get("user_id"),"TICKET_REPLIED",Map.of("ticket_number",num==null?id:num),"New reply on your support ticket","Support replied to your ticket. Open it to read the response.");
    return Map.of("message",jdbc.query("select * from support_messages where id=?",(r,n)->map(r),mid).getFirst());}
  Map<String,Object> notifyCustomer(String userId,String templateKey,Map<String,String> vars,String fbTitle,String fbBody){
    var tpl=jdbc.query("select title,body from notification_templates where key=? and active=true",(r,n)->map(r),templateKey).stream().findFirst().orElse(null);
    String title=fbTitle,body=fbBody;
    if(tpl!=null){title=fill((String)tpl.get("title"),vars);body=fill((String)tpl.get("body"),vars);}
    jdbc.update("insert into notifications(id,user_id,type,title,body) values(?,?, 'SUPPORT_UPDATE',?,?)",UUID.randomUUID().toString(),userId,title,body);
    return Map.of("via",tpl!=null?"template":"fallback");}
  static String fill(String text,Map<String,String> vars){String out=text;for(var e:vars.entrySet())out=out.replaceAll("\\{\\{\\s*"+e.getKey()+"\\s*\\}\\}",java.util.regex.Matcher.quoteReplacement(e.getValue()));return out;}

  // ---- notifications ----
  @GetMapping("/notifications") Map<String,Object> notifications(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String search,@RequestParam(required=false) String type,@RequestParam(required=false) String userId,@RequestParam(required=false) String unreadOnly,@RequestParam(required=false) String limit,@RequestParam(required=false) String offset){admin(u);
    var f=new ArrayList<String>();var params=new ArrayList<Object>();
    if(opt(search,120)!=null&&!search.isBlank()){String t="%"+search.trim().toLowerCase()+"%";f.add("(lower(u.email) like ? or lower(n.title) like ? or lower(n.body) like ?)");params.add(t);params.add(t);params.add(t);}
    if(opt(type,40)!=null&&!type.isBlank()){f.add("n.type = ?");params.add(type);}
    if(opt(userId,80)!=null&&!userId.isBlank()){f.add("n.user_id = ?");params.add(userId);}
    if("true".equalsIgnoreCase(unreadOnly)||"1".equals(unreadOnly))f.add("n.is_read = false");
    String where=f.isEmpty()?"":"where "+String.join(" AND ",f);
    String from="from notifications n join users u on u.id=n.user_id left join returns r on r.id=n.return_id";
    int total=jdbc.queryForObject("select count(*) "+from+" "+where,Integer.class,params.toArray());
    var p2=new ArrayList<Object>(params);p2.add(lim(limit));p2.add(off(offset));
    var out=new LinkedHashMap<String,Object>();out.put("notifications",jdbc.query("select n.id,n.user_id,u.email as user_email,n.return_id,r.return_number,n.type,n.title,n.body,n.is_read::int as is_read,n.created_at "+from+" "+where+" order by n.created_at desc limit ? offset ?",(r,n)->map(r),p2.toArray()));out.put("total",total);return out;}
  @GetMapping("/notifications/templates") Map<String,Object> templates(@AuthenticationPrincipal CurrentUser u){admin(u);
    return Map.of("templates",jdbc.query("select key,title,body,active::int as active,updated_at from notification_templates order by key asc",(r,n)->map(r)));}
  record TemplateBody(@NotBlank @Size(max=200) String title,@NotBlank @Size(max=2000) String body,Boolean active){}
  @PutMapping("/notifications/templates/{key}") @Transactional Map<String,Object> upsertTemplate(@AuthenticationPrincipal CurrentUser u,@PathVariable String key,@Valid @RequestBody TemplateBody b, jakarta.servlet.http.HttpServletRequest req){admin(u);
    String norm=key.trim().toUpperCase();
    if(!norm.matches("^[A-Z][A-Z0-9_]{1,59}$"))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Template key must start with a letter and contain only A-Z, 0-9 and underscore");
    String title=b.title().trim(),body=b.body().trim();
    if(title.isEmpty()||body.isEmpty())throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Template title and body are required");
    var before=jdbc.query("select key,title,body,active::int as active,updated_at from notification_templates where key=?",(r,n)->map(r),norm).stream().findFirst().orElse(null);
    boolean active=b.active()==null?(before==null?true:isActive(before.get("active"))):b.active();
    var t=OffsetDateTime.now(ZoneOffset.UTC);
    jdbc.update("insert into notification_templates(key,title,body,active,updated_at) values(?,?,?,?,?) on conflict(key) do update set title=excluded.title,body=excluded.body,active=excluded.active,updated_at=excluded.updated_at",norm,title,body,active,t);
    var after=jdbc.query("select key,title,body,active::int as active,updated_at from notification_templates where key=?",(r,n)->map(r),norm).getFirst();
    auditWrite(u.id(),ipOf(req),"TEMPLATE_SAVED","TEMPLATE",norm,before,after,null);
    return Map.of("template",after);}

  // ---- reports ----
  String csvFile(String prefix){return prefix+"-"+LocalDate.now(ZoneOffset.UTC)+".csv";}
  static String cell(Object v){String t=v==null?"":String.valueOf(v);if(!t.isEmpty()&&"=+-@\t\r".indexOf(t.charAt(0))>=0)t="'"+t;if(t.contains("\"")||t.contains(",")||t.contains("\n")||t.contains("\r"))return "\""+t.replace("\"","\"\"")+"\"";return t;}
  static String toCsv(List<String> header,List<List<Object>> rows){var sb=new StringBuilder();var hc=new ArrayList<String>();for(String h:header)hc.add(cell(h));sb.append(String.join(",",hc));sb.append("\r\n");for(var row:rows){var c=new ArrayList<String>();for(Object o:row)c.add(cell(o));sb.append(String.join(",",c));sb.append("\r\n");}return sb.toString();}
  int cap(String v){if(v==null)return 10000;int n;try{n=Integer.parseInt(v);}catch(Exception e){return 10000;}if(n<1)return 10000;return Math.min(n,10000);}
  org.springframework.http.ResponseEntity<String> csv(String filename,String body){return org.springframework.http.ResponseEntity.ok().header("Content-Type","text/csv; charset=utf-8").header("Content-Disposition","attachment; filename=\""+filename+"\"").body(body);}
  List<Object> rowVals(Map<String,Object> r,String... keys){var l=new ArrayList<Object>();for(String k:keys)l.add(r.get(k));return l;}
  @GetMapping("/reports/orders.csv") org.springframework.http.ResponseEntity<String> ordersCsv(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String search,@RequestParam(required=false) String status,@RequestParam(required=false) String limit){admin(u);
    var f=new ArrayList<String>();var p=new ArrayList<Object>();
    if(search!=null&&!search.isBlank()){String t="%"+search.trim().toLowerCase()+"%";f.add("(lower(o.order_number) like ? or lower(u.email) like ? or lower(u.full_name) like ?)");p.add(t);p.add(t);p.add(t);}
    if(status!=null&&!status.isBlank()){f.add("o.status = ?");p.add(status);}
    String w=f.isEmpty()?"":"where "+String.join(" AND ",f);p.add(cap(limit));
    var rows=jdbc.query("select o.order_number as c0,u.email as c1,u.full_name as c2,(select count(*) from order_items oi where oi.order_id=o.id) as c3,o.subtotal_paise as c4,o.payment_status as c5,o.status as c6,o.carrier as c7,o.tracking_number as c8,o.created_at as c9 from orders o join users u on u.id=o.customer_id "+w+" order by o.created_at desc limit ?",(r,n)->map(r),p.toArray());
    var out=new ArrayList<List<Object>>();for(var r:rows)out.add(rowVals(r,"c0","c1","c2","c3","c4","c5","c6","c7","c8","c9"));
    return csv(csvFile("orders"),toCsv(List.of("order_number","customer_email","customer_name","items","subtotal_paise","payment_status","status","carrier","tracking_number","created_at"),out));}
  @GetMapping("/reports/returns.csv") org.springframework.http.ResponseEntity<String> returnsCsv(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String search,@RequestParam(required=false) String status,@RequestParam(required=false) String resolution,@RequestParam(required=false) String limit){admin(u);
    var f=new ArrayList<String>();var p=new ArrayList<Object>();
    if(search!=null&&!search.isBlank()){String t="%"+search.trim().toLowerCase()+"%";f.add("(lower(r.return_number) like ? or lower(o.order_number) like ? or lower(u.email) like ?)");p.add(t);p.add(t);p.add(t);}
    if(status!=null&&!status.isBlank()){f.add("r.status = ?");p.add(status);}
    if(resolution!=null&&!resolution.isBlank()){f.add("r.resolution_type = ?");p.add(resolution);}
    String w=f.isEmpty()?"":"where "+String.join(" AND ",f);p.add(cap(limit));
    var rows=jdbc.query("select r.return_number as c0,o.order_number as c1,u.email as c2,(select oi.product_name from return_items ri join order_items oi on oi.id=ri.order_item_id where ri.return_id=r.id limit 1) as c3,(select oi.sku from return_items ri join order_items oi on oi.id=ri.order_item_id where ri.return_id=r.id limit 1) as c4,(select coalesce(sum(ri.quantity),0) from return_items ri where ri.return_id=r.id) as c5,(select ri.reason_code from return_items ri where ri.return_id=r.id limit 1) as c6,r.status as c7,r.resolution_type as c8,r.created_at as c9 from returns r left join orders o on o.id=r.order_id join users u on u.id=r.customer_id "+w+" order by r.created_at desc limit ?",(r,n)->map(r),p.toArray());
    var out=new ArrayList<List<Object>>();for(var r:rows)out.add(rowVals(r,"c0","c1","c2","c3","c4","c5","c6","c7","c8","c9"));
    return csv(csvFile("returns"),toCsv(List.of("return_number","order_number","customer_email","product_name","sku","quantity","reason_code","status","resolution_type","created_at"),out));}
  @GetMapping("/reports/refunds.csv") org.springframework.http.ResponseEntity<String> refundsCsv(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String search,@RequestParam(required=false) String status,@RequestParam(required=false) String kind,@RequestParam(required=false) String limit){admin(u);
    var f=new ArrayList<String>();var p=new ArrayList<Object>();
    if(search!=null&&!search.isBlank()){String t="%"+search.trim().toLowerCase()+"%";f.add("(lower(r.return_number) like ? or lower(o.order_number) like ? or lower(u.email) like ?)");p.add(t);p.add(t);p.add(t);}
    if(status!=null&&!status.isBlank()){f.add("f.status = ?");p.add(status);}
    if(kind!=null&&!kind.isBlank()){f.add("f.kind = ?");p.add(kind);}
    String w=f.isEmpty()?"":"where "+String.join(" AND ",f);p.add(cap(limit));
    var rows=jdbc.query("select f.id as c0,r.return_number as c1,o.order_number as c2,u.email as c3,f.kind as c4,f.amount_paise as c5,f.method as c6,f.status as c7,f.initiated_at as c8,f.completed_at as c9 from refunds f join returns r on r.id=f.return_id left join orders o on o.id=r.order_id join users u on u.id=r.customer_id "+w+" order by r.created_at desc limit ?",(r,n)->map(r),p.toArray());
    var out=new ArrayList<List<Object>>();for(var r:rows)out.add(rowVals(r,"c0","c1","c2","c3","c4","c5","c6","c7","c8","c9"));
    return csv(csvFile("refunds"),toCsv(List.of("id","return_number","order_number","customer_email","kind","amount_paise","method","status","initiated_at","completed_at"),out));}
  @GetMapping("/reports/credit.csv") org.springframework.http.ResponseEntity<String> creditCsv(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String userId,@RequestParam(required=false) String type,@RequestParam(required=false) String limit){admin(u);
    var f=new ArrayList<String>();var p=new ArrayList<Object>();
    if(userId!=null&&!userId.isBlank()){f.add("l.user_id = ?");p.add(userId);}
    if(type!=null&&!type.isBlank()){f.add("l.type = ?");p.add(type);}
    String w=f.isEmpty()?"":"where "+String.join(" AND ",f);p.add(cap(limit));
    var rows=jdbc.query("select l.id as c0,u.email as c1,l.type as c2,l.amount_paise as c3,l.reason as c4,l.reference_type as c5,l.reference_id as c6,l.created_at as c7 from store_credit_ledger l join users u on u.id=l.user_id "+w+" order by l.created_at desc limit ?",(r,n)->map(r),p.toArray());
    var out=new ArrayList<List<Object>>();for(var r:rows)out.add(rowVals(r,"c0","c1","c2","c3","c4","c5","c6","c7"));
    return csv(csvFile("credit"),toCsv(List.of("id","user_email","type","amount_paise","reason","reference_type","reference_id","created_at"),out));}
  @GetMapping("/reports/inventory.csv") org.springframework.http.ResponseEntity<String> inventoryCsv(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String search,@RequestParam(required=false) String limit){admin(u);
    var f=new ArrayList<String>();var p=new ArrayList<Object>();
    if(search!=null&&!search.isBlank()){String t="%"+search.trim().toLowerCase()+"%";f.add("(lower(p.sku) like ? or lower(p.name) like ?)");p.add(t);p.add(t);}
    String w=f.isEmpty()?"":"where "+String.join(" AND ",f);p.add(cap(limit));
    var products=jdbc.query("select id,sku,name,stock from products p "+w+" order by name asc limit ?",(r,n)->map(r),p.toArray());
    var out=new ArrayList<List<Object>>();
    for(var prod:products){
      var buckets=jdbc.query("select warehouse_id,state,quantity from inventory_buckets where product_id=? order by state asc",(r,n)->map(r),prod.get("id"));
      if(buckets.isEmpty())out.add(List.of(prod.get("sku"),prod.get("name"),"", "",prod.get("stock")));
      for(var b:buckets)out.add(List.of(prod.get("sku"),prod.get("name"),b.get("warehouse_id"),b.get("state"),b.get("quantity")));
    }
    return csv(csvFile("inventory"),toCsv(List.of("sku","product","warehouse_id","state","quantity"),out));}
  @GetMapping("/reports/movements.csv") org.springframework.http.ResponseEntity<String> movementsCsv(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String warehouseId,@RequestParam(required=false) String productId,@RequestParam(required=false) String reason,@RequestParam(required=false) String limit){admin(u);
    var f=new ArrayList<String>();var p=new ArrayList<Object>();
    if(warehouseId!=null&&!warehouseId.isBlank()){f.add("m.warehouse_id = ?");p.add(warehouseId);}
    if(productId!=null&&!productId.isBlank()){f.add("m.product_id = ?");p.add(productId);}
    if(reason!=null&&!reason.isBlank()){f.add("m.reason = ?");p.add(reason);}
    String w=f.isEmpty()?"":"where "+String.join(" AND ",f);p.add(cap(limit));
    var rows=jdbc.query("select m.id as c0,m.warehouse_id as c1,m.sku as c2,m.quantity as c3,m.from_state as c4,m.to_state as c5,m.reason as c6,m.reference_type as c7,m.reference_id as c8,m.created_at as c9 from inventory_movements m "+w+" order by m.created_at desc,m.id desc limit ?",(r,n)->map(r),p.toArray());
    var out=new ArrayList<List<Object>>();for(var r:rows)out.add(rowVals(r,"c0","c1","c2","c3","c4","c5","c6","c7","c8","c9"));
    return csv(csvFile("movements"),toCsv(List.of("id","warehouse_id","sku","quantity","from_state","to_state","reason","reference_type","reference_id","created_at"),out));}
}
