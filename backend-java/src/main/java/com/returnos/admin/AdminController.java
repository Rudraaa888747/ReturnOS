package com.returnos.admin;

import com.returnos.auth.CurrentUser;
import com.returnos.common.ApiException;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/v1/admin") public class AdminController {
  static final List<String> PERMISSIONS = List.of("ADMIN_DASHBOARD_VIEW","CUSTOMER_VIEW","CUSTOMER_MANAGE","ORDER_VIEW","ORDER_MANAGE","RETURN_VIEW","RETURN_MANAGE","REFUND_VIEW","REFUND_MANAGE","STORE_CREDIT_VIEW","STORE_CREDIT_MANAGE","PRODUCT_VIEW","PRODUCT_MANAGE","INVENTORY_VIEW","INVENTORY_MANAGE","WAREHOUSE_VIEW","WAREHOUSE_MANAGE","SUPPORT_VIEW","SUPPORT_MANAGE","USER_MANAGE","ANALYTICS_VIEW","AUDIT_VIEW","SETTINGS_MANAGE");

  private final JdbcTemplate jdbc; private final com.returnos.warehouse.WarehouseService wh;
  AdminController(JdbcTemplate jdbc,com.returnos.warehouse.WarehouseService wh){this.jdbc=jdbc;this.wh=wh;}

  CurrentUser admin(CurrentUser u){
    if(u==null)throw new ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHORIZED","Authentication required");
    if(!"ADMIN".equals(u.role()))throw new ApiException(HttpStatus.FORBIDDEN,"ADMIN_REQUIRED","Admin access required");
    return u;
  }
  static void bad(boolean cond,String msg){if(cond)throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR",msg==null?"Request validation failed":msg);}
  int limit(String v){if(v==null)return 25;try{int n=Integer.parseInt(v);bad(n<1||n>100,"Invalid limit");return n;}catch(ApiException e){throw e;}catch(Exception e){throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid limit");}}
  int offset(String v){if(v==null)return 0;try{int n=Integer.parseInt(v);bad(n<0,"Invalid offset");return n;}catch(ApiException e){throw e;}catch(Exception e){throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid offset");}}
  String opt(String v,int max){if(v==null)return null;bad(v.length()>max,"Parameter too long");return v;}
  String dir(String v,String fallback){if(v==null)return fallback;if("DESC".equalsIgnoreCase(v))return "DESC";if("ASC".equalsIgnoreCase(v))return "ASC";return fallback;}
  Object dateParam(String v){if(v==null||v.isBlank())return null;bad(v.length()>40,"Invalid date");var t=parseInstant(v);bad(t==null,"Invalid date");return t;}
  static OffsetDateTime parseInstant(String v){String s=v.trim().replace(' ','T');try{return OffsetDateTime.parse(s);}catch(Exception a){}try{return LocalDateTime.parse(s).atOffset(ZoneOffset.UTC);}catch(Exception b){}try{return OffsetDateTime.ofInstant(Instant.parse(s),ZoneOffset.UTC);}catch(Exception c){}try{return LocalDate.parse(s).atStartOfDay().atOffset(ZoneOffset.UTC);}catch(Exception d){}return null;}
  static Map<String,Object> map(java.sql.ResultSet r)throws java.sql.SQLException{var x=new LinkedHashMap<String,Object>();var m=r.getMetaData();for(int i=1;i<=m.getColumnCount();i++)x.put(m.getColumnLabel(i),r.getObject(i));return x;}

  @GetMapping("/me") Map<String,Object> me(@AuthenticationPrincipal CurrentUser u){admin(u);
    return Map.of("user",Map.of("id",u.id(),"email",u.email(),"role",u.role()),"permissions",PERMISSIONS);}

  @GetMapping("/audit") Map<String,Object> audit(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String action,@RequestParam(required=false) String entityType,@RequestParam(required=false) String entityId,@RequestParam(required=false) String actorId,@RequestParam(required=false) String limit,@RequestParam(required=false) String offset){admin(u);
    var f=new ArrayList<String>();var params=new ArrayList<Object>();
    if(opt(action,80)!=null){f.add("action = ?");params.add(action);}
    if(opt(entityType,40)!=null){f.add("entity_type = ?");params.add(entityType);}
    if(opt(entityId,80)!=null){f.add("entity_id = ?");params.add(entityId);}
    if(opt(actorId,80)!=null){f.add("actor_id = ?");params.add(actorId);}
    String where=f.isEmpty()?"":"where "+String.join(" AND ",f);
    int total=jdbc.queryForObject("select count(*) from admin_audit_log "+where,Integer.class,params.toArray());
    var p2=new ArrayList<Object>(params);int lim=limit(limit),off=offset(offset);p2.add(lim);p2.add(off);
    var out=new LinkedHashMap<String,Object>();out.put("entries",jdbc.query("select * from admin_audit_log "+where+" order by created_at desc,id desc limit ? offset ?",(r,n)->map(r),p2.toArray()));out.put("total",total);return out;}

  @GetMapping("/summary") Map<String,Object> summary(@AuthenticationPrincipal CurrentUser u){admin(u);return dashboard();}

  Map<String,Object> dashboard(){
    var today=LocalDate.now(ZoneOffset.UTC).atStartOfDay().atOffset(ZoneOffset.UTC);
    var weekAgo=today.minusDays(7);var monthAgo=OffsetDateTime.now(ZoneOffset.UTC).minusDays(30);var dayAgo=OffsetDateTime.now(ZoneOffset.UTC).minusHours(24);
    int pendingDisp=jdbc.queryForObject("select count(distinct ri.return_id) from return_items ri join inspections i on i.return_id=ri.return_id where i.completed_at is not null and not exists (select 1 from dispositions d where d.return_item_id=ri.id)",Integer.class);
    var credit=jdbc.queryForObject("select coalesce(sum(case when type='CREDIT' then amount_paise else 0 end),0) as issued,coalesce(sum(case when type='DEBIT' then -amount_paise else 0 end),0) as used from store_credit_ledger",(rs,n)->Map.of("issued",rs.getInt(1),"used",rs.getInt(2)));
    var out=new LinkedHashMap<String,Object>();
    var commerce=new LinkedHashMap<String,Object>();commerce.put("totalOrders",count("orders","1 = 1"));commerce.put("ordersToday",countP("orders","created_at >= ?",today));commerce.put("pendingOrders",count("orders","status not in ('DELIVERED','CANCELLED')"));commerce.put("deliveredOrders",count("orders","status = 'DELIVERED'"));commerce.put("cancelledOrders",count("orders","status = 'CANCELLED'"));out.put("commerce",commerce);
    var returns=new LinkedHashMap<String,Object>();returns.put("totalReturns",count("returns","1 = 1"));returns.put("newReturns",count("returns","status = 'REQUESTED'"));returns.put("pendingReceiving",count("returns","status in ('APPROVED','PICKED_UP','IN_TRANSIT')"));returns.put("pendingInspection",count("returns","status = 'RECEIVED'"));returns.put("pendingDisposition",pendingDisp);returns.put("completedReturns",count("returns","status = 'RESOLVED'"));out.put("returns",returns);
    var fin=new LinkedHashMap<String,Object>();fin.put("refundsPending",count("refunds","status = 'PENDING'"));fin.put("refundsCompleted",count("refunds","status = 'COMPLETED'"));fin.put("refundsCompletedPaise",jdbc.queryForObject("select coalesce(sum(amount_paise),0) from refunds where status = 'COMPLETED'",Integer.class));fin.put("creditIssuedPaise",credit.get("issued"));fin.put("creditUsedPaise",credit.get("used"));out.put("financial",fin);
    var ware=new LinkedHashMap<String,Object>();ware.put("pendingTasks",count("warehouse_tasks","status in ('TODO','IN_PROGRESS')"));ware.put("overdueTasks",countP("warehouse_tasks","status in ('TODO','IN_PROGRESS') and due_at < ?",OffsetDateTime.now(ZoneOffset.UTC)));ware.put("inventoryAlerts",countP("audit_log","action like 'WARNING_%' and created_at >= ?",dayAgo));out.put("warehouse",ware);
    var rec=new LinkedHashMap<String,Object>();rec.put("recoveredValuePaise",jdbc.queryForObject("select coalesce(sum(recovery_value_paise),0) from dispositions",Integer.class));rec.put("restockedUnits",recUnits("RESTOCK"));rec.put("resaleUnits",recUnits("RESELL"));rec.put("repairUnits",recUnits("REPAIR"));rec.put("vendorReturnUnits",recUnits("RETURN_TO_VENDOR"));rec.put("disposalUnits",recUnits("DISPOSE"));out.put("recovery",rec);
    var cust=new LinkedHashMap<String,Object>();cust.put("totalCustomers",count("users","role = 'CUSTOMER'"));cust.put("newCustomers",countP("users","role = 'CUSTOMER' and created_at >= ?",weekAgo));cust.put("activeCustomers",jdbc.queryForObject("select count(distinct customer_id) from orders where created_at >= ?",Integer.class,monthAgo));out.put("customers",cust);
    String nonTerminal="status not in ('RESOLVED','CANCELLED','REJECTED')";
    out.put("pendingReturns",jdbc.query("select id,return_number,status,created_at from returns where "+nonTerminal+" order by created_at desc limit 5",(r,n)->map(r)));
    out.put("pendingRefunds",jdbc.query("select f.id,r.return_number,f.amount_paise,f.status from refunds f join returns r on r.id=f.return_id where f.status = 'PENDING' order by r.created_at desc limit 5",(r,n)->map(r)));
    out.put("warehouseAlerts",jdbc.query("select action,count(*) as count from audit_log where action like 'WARNING_%' and created_at >= ? group by action order by count desc",(r,n)->map(r),dayAgo));
    out.put("overdueTasksList",jdbc.query("select id,title,kind,due_at from warehouse_tasks where status in ('TODO','IN_PROGRESS') and due_at < ? order by due_at asc limit 5",(r,n)->map(r),OffsetDateTime.now(ZoneOffset.UTC)));
    out.put("inventoryIssues",jdbc.query("select action,count(*) as count from audit_log where (action like '%INVENTORY%' or action like '%SHORTFALL%' or action like '%FALLBACK%') and created_at >= ? group by action order by count desc",(r,n)->map(r),dayAgo));
    out.put("openTickets",jdbc.query("select id,ticket_number,subject,status from support_tickets where status = 'OPEN' order by created_at desc limit 5",(r,n)->map(r)));
    out.put("recentOrders",jdbc.query("select id,order_number,status,created_at from orders order by created_at desc limit 5",(r,n)->map(r)));
    out.put("recentReturns",jdbc.query("select id,return_number,status,created_at from returns order by created_at desc limit 5",(r,n)->map(r)));
    out.put("recentAdminActivity",jdbc.query("select id,action,entity_type,created_at from admin_audit_log order by created_at desc limit 5",(r,n)->map(r)));
    return out;
  }
  int count(String table,String where){return jdbc.queryForObject("select count(*) from "+table+" where "+where,Integer.class);}
  int countP(String table,String where,Object... p){var a=new ArrayList<Object>(List.of(p));return jdbc.queryForObject("select count(*) from "+table+" where "+where,Integer.class,a.toArray());}
  int recUnits(String action){return jdbc.queryForObject("select coalesce(sum(quantity),0) from dispositions where action=?",Integer.class,action);}

  static final Map<String,String> CUSTOMER_SORTS=Map.of("created_at","u.created_at","full_name","u.full_name","email","u.email","orders","orders_count","credit","credit_balance_paise","activity","last_activity");
  @GetMapping("/customers") Map<String,Object> customers(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String search,@RequestParam(required=false) String sort,@RequestParam(required=false) String dir,@RequestParam(required=false) String limit,@RequestParam(required=false) String offset){admin(u);
    var f=new ArrayList<String>();f.add("u.role = 'CUSTOMER'");var params=new ArrayList<Object>();
    if(opt(search,120)!=null&&!search.isBlank()){String t="%"+search.trim().toLowerCase()+"%";f.add("(lower(u.email) like ? or lower(u.full_name) like ?)");params.add(t);params.add(t);}
    String where="where "+String.join(" AND ",f);
    String orderBy=CUSTOMER_SORTS.getOrDefault(sort==null?"created_at":sort,"u.created_at");
    int total=jdbc.queryForObject("select count(*) from users u "+where,Integer.class,params.toArray());
    var p2=new ArrayList<Object>(params);int lim=limit(limit),off=offset(offset);p2.add(lim);p2.add(off);
    var out=new LinkedHashMap<String,Object>();out.put("customers",jdbc.query("select u.id,u.email,u.full_name,p.phone,u.active::int as active,u.created_at,(select count(*) from orders o where o.customer_id=u.id) as orders_count,(select count(*) from returns r where r.customer_id=u.id) as returns_count,(select coalesce(sum(amount_paise),0) from store_credit_ledger l where l.user_id=u.id) as credit_balance_paise,(select max(created_at) from (select created_at from orders where customer_id=u.id union all select created_at from returns where customer_id=u.id) t) as last_activity from users u left join customer_profiles p on p.user_id=u.id "+where+" order by "+orderBy+" "+dir(dir,"DESC")+" limit ? offset ?",(r,n)->map(r),p2.toArray()));out.put("total",total);return out;}

  @GetMapping("/customers/{id}") Map<String,Object> customerDetail(@AuthenticationPrincipal CurrentUser u,@PathVariable String id){admin(u);
    var users=jdbc.query("select u.id,u.email,u.full_name,u.role,u.active::int as active,u.created_at,p.phone from users u left join customer_profiles p on p.user_id=u.id where u.id=? and u.role='CUSTOMER'",(r,n)->map(r),id);
    if(users.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"CUSTOMER_NOT_FOUND","Customer not found");
    var out=new LinkedHashMap<String,Object>();out.put("user",users.getFirst());
    out.put("orders",jdbc.query("select id,order_number,status,subtotal_paise,created_at,delivered_at from orders where customer_id=? order by created_at desc",(r,n)->map(r),id));
    out.put("returns",jdbc.query("select id,return_number,order_id,status,resolution_type,created_at from returns where customer_id=? order by created_at desc",(r,n)->map(r),id));
    out.put("refunds",jdbc.query("select f.id,r.return_number,f.amount_paise,f.method,f.status from refunds f join returns r on r.id=f.return_id where r.customer_id=? order by r.created_at desc",(r,n)->map(r),id));
    var credit=new LinkedHashMap<String,Object>();credit.put("balancePaise",jdbc.queryForObject("select coalesce(sum(amount_paise),0) from store_credit_ledger where user_id=?",Integer.class,id));credit.put("history",jdbc.query("select id,type,amount_paise,reason,reference_type,reference_id,created_at from store_credit_ledger where user_id=? order by created_at desc limit 100",(r,n)->map(r),id));out.put("credit",credit);
    out.put("tickets",jdbc.query("select id,ticket_number,subject,status,updated_at from support_tickets where user_id=? order by created_at desc",(r,n)->map(r),id));
    out.put("activity",jdbc.query("select kind,status,description,created_at from (select 'order' as kind,oe.status,oe.description,oe.created_at from order_events oe join orders o on o.id=oe.order_id where o.customer_id=? union all select 'return' as kind,re.status,re.description,re.created_at from return_events re join returns r on r.id=re.return_id where r.customer_id=?) t order by created_at desc limit 20",(r,n)->map(r),id,id));
    return out;}

  static final Map<String,String> ORDER_SORTS=Map.of("created_at","o.created_at","subtotal","o.subtotal_paise","order_number","o.order_number","status","o.status");
  @GetMapping("/orders") Map<String,Object> orders(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String search,@RequestParam(required=false) String status,@RequestParam(required=false) String customerId,@RequestParam(required=false) String from,@RequestParam(required=false) String to,@RequestParam(required=false) String sort,@RequestParam(required=false) String dir,@RequestParam(required=false) String limit,@RequestParam(required=false) String offset){admin(u);
    var f=new ArrayList<String>();var params=new ArrayList<Object>();
    if(opt(search,120)!=null&&!search.isBlank()){String t="%"+search.trim().toLowerCase()+"%";f.add("(lower(o.order_number) like ? or lower(u.email) like ? or lower(u.full_name) like ? or exists (select 1 from order_items oi where oi.order_id=o.id and (lower(oi.sku) like ? or lower(oi.product_name) like ?)))");params.add(t);params.add(t);params.add(t);params.add(t);params.add(t);}
    if(opt(status,40)!=null&&!status.isBlank()){f.add("o.status = ?");params.add(status);}
    if(opt(customerId,80)!=null&&!customerId.isBlank()){f.add("o.customer_id = ?");params.add(customerId);}
    Object fD=dateParam(from),tD=dateParam(to);if(fD!=null){f.add("o.created_at >= ?");params.add(fD);}if(tD!=null){f.add("o.created_at <= ?");params.add(tD);}
    String where=f.isEmpty()?"":"where "+String.join(" AND ",f);
    String orderBy=ORDER_SORTS.getOrDefault(sort==null?"created_at":sort,"o.created_at");
    int total=jdbc.queryForObject("select count(*) from orders o join users u on u.id=o.customer_id "+where,Integer.class,params.toArray());
    var p2=new ArrayList<Object>(params);int lim=limit(limit),off=offset(offset);p2.add(lim);p2.add(off);
    var out=new LinkedHashMap<String,Object>();out.put("orders",jdbc.query("select o.id,o.order_number,o.customer_id,u.email as customer_email,u.full_name as customer_name,(select count(*) from order_items oi where oi.order_id=o.id) as items_count,o.subtotal_paise,o.payment_status,o.status,o.carrier,o.tracking_number,o.created_at from orders o join users u on u.id=o.customer_id "+where+" order by "+orderBy+" "+dir(dir,"DESC")+" limit ? offset ?",(r,n)->map(r),p2.toArray()));out.put("total",total);return out;}

  @GetMapping("/orders/{id}") Map<String,Object> orderDetail(@AuthenticationPrincipal CurrentUser u,@PathVariable String id){admin(u);
    var oo=jdbc.query("select id,order_number,customer_id,status,subtotal_paise,created_at,delivered_at,shipping_address,payment_status,payment_method,carrier,tracking_number,kind,source_return_id,credit_used_paise,shipping_paise,discount_paise,estimated_delivery from orders where id=?",(r,n)->map(r),id);
    if(oo.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"ORDER_NOT_FOUND","Order not found");
    var out=new LinkedHashMap<String,Object>();out.put("order",oo.getFirst());
    var cust=jdbc.query("select id,email,full_name from users where id=?",(r,n)->map(r),oo.getFirst().get("customer_id"));
    out.put("customer",cust.isEmpty()?Map.of("id",oo.getFirst().get("customer_id"),"email","","full_name",""):cust.getFirst());
    out.put("items",jdbc.query("select id,product_id,sku,product_name,quantity,unit_price_paise,line_total_paise,product_image_url from order_items where order_id=?",(r,n)->map(r),id));
    out.put("events",jdbc.query("select id,status,description,created_at from order_events where order_id=? order by created_at asc",(r,n)->map(r),id));
    out.put("returns",jdbc.query("select id,return_number,status,resolution_type from returns where order_id=? order by created_at asc",(r,n)->map(r),id));
    out.put("refunds",jdbc.query("select f.id,r.return_number,f.amount_paise,f.method,f.status from refunds f join returns r on r.id=f.return_id where r.order_id=?",(r,n)->map(r),id));
    out.put("replacements",jdbc.query("select id,order_number,kind,status,source_return_id from orders where source_return_id in (select id from returns where order_id=?)",(r,n)->map(r),id));
    return out;}

  static final Map<String,String> RETURN_SORTS=Map.of("created_at","r.created_at","updated_at","r.updated_at","return_number","r.return_number","status","r.status");
  @GetMapping("/returns") Map<String,Object> returns(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String search,@RequestParam(required=false) String status,@RequestParam(required=false) String resolution,@RequestParam(required=false) String customerId,@RequestParam(required=false) String productId,@RequestParam(required=false) String warehouseId,@RequestParam(required=false) String from,@RequestParam(required=false) String to,@RequestParam(required=false) String sort,@RequestParam(required=false) String dir,@RequestParam(required=false) String limit,@RequestParam(required=false) String offset){admin(u);
    var f=new ArrayList<String>();var params=new ArrayList<Object>();
    if(opt(search,120)!=null&&!search.isBlank()){String t="%"+search.trim().toLowerCase()+"%";f.add("(lower(r.return_number) like ? or lower(o.order_number) like ? or lower(u.email) like ? or exists (select 1 from return_items ri join order_items oi on oi.id=ri.order_item_id where ri.return_id=r.id and (lower(oi.sku) like ? or lower(oi.product_name) like ?)))");params.add(t);params.add(t);params.add(t);params.add(t);params.add(t);}
    if(opt(status,40)!=null&&!status.isBlank()){f.add("r.status = ?");params.add(status);}
    if(opt(resolution,40)!=null&&!resolution.isBlank()){f.add("r.resolution_type = ?");params.add(resolution);}
    if(opt(customerId,80)!=null&&!customerId.isBlank()){f.add("r.customer_id = ?");params.add(customerId);}
    if(opt(productId,80)!=null&&!productId.isBlank()){f.add("exists (select 1 from return_items ri join order_items oi on oi.id=ri.order_item_id where ri.return_id=r.id and oi.product_id=?)");params.add(productId);}
    if(opt(warehouseId,80)!=null&&!warehouseId.isBlank()){f.add("exists (select 1 from receiving_records rr where rr.return_id=r.id and rr.warehouse_id=?)");params.add(warehouseId);}
    Object fD=dateParam(from),tD=dateParam(to);if(fD!=null){f.add("r.created_at >= ?");params.add(fD);}if(tD!=null){f.add("r.created_at <= ?");params.add(tD);}
    String where=f.isEmpty()?"":"where "+String.join(" AND ",f);
    String orderBy=RETURN_SORTS.getOrDefault(sort==null?"created_at":sort,"r.created_at");
    int total=jdbc.queryForObject("select count(*) from returns r left join orders o on o.id=r.order_id join users u on u.id=r.customer_id "+where,Integer.class,params.toArray());
    var p2=new ArrayList<Object>(params);int lim=limit(limit),off=offset(offset);p2.add(lim);p2.add(off);
    var out=new LinkedHashMap<String,Object>();out.put("returns",jdbc.query("select r.id,r.return_number,r.order_id,o.order_number,r.customer_id,u.email as customer_email,u.full_name as customer_name,(select oi.product_name from return_items ri join order_items oi on oi.id=ri.order_item_id where ri.return_id=r.id limit 1) as product_name,(select oi.sku from return_items ri join order_items oi on oi.id=ri.order_item_id where ri.return_id=r.id limit 1) as sku,(select coalesce(sum(ri.quantity),0) from return_items ri where ri.return_id=r.id) as quantity,(select ri.reason_code from return_items ri where ri.return_id=r.id limit 1) as reason_code,r.status,r.resolution_type,r.created_at from returns r left join orders o on o.id=r.order_id join users u on u.id=r.customer_id "+where+" order by "+orderBy+" "+dir(dir,"DESC")+" limit ? offset ?",(r,n)->map(r),p2.toArray()));out.put("total",total);return out;}

  @GetMapping("/returns/{id}") Map<String,Object> returnDetail(@AuthenticationPrincipal CurrentUser u,@PathVariable String id){admin(u);
    var rets=jdbc.query("select id,return_number,order_id,customer_id,status,resolution_type,description,created_at,updated_at,cancelled_at,cancel_reason,approved_at,approved_by from returns where id=?",(r,n)->map(r),id);
    if(rets.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"RETURN_NOT_FOUND","Return not found");
    var ret=rets.getFirst();var out=new LinkedHashMap<String,Object>();out.put("ret",ret);
    var cust=jdbc.query("select id,email,full_name from users where id=?",(r,n)->map(r),ret.get("customer_id"));
    out.put("customer",cust.isEmpty()?Map.of("id",ret.get("customer_id"),"email","","full_name",""):cust.getFirst());
    var ords=jdbc.query("select id,order_number,status,subtotal_paise,created_at,delivered_at from orders where id=?",(r,n)->map(r),ret.get("order_id"));
    out.put("order",ords.isEmpty()?null:ords.getFirst());
    out.put("items",jdbc.query("select ri.id,ri.order_item_id,oi.product_id,oi.sku,oi.product_name,ri.quantity,ri.reason_code,rr.label as reason_label,ri.description from return_items ri join order_items oi on oi.id=ri.order_item_id left join return_reasons rr on rr.code=ri.reason_code where ri.return_id=? order by oi.product_name asc",(r,n)->map(r),id));
    out.put("pickup",one("select id,kind,address,date,time_window,carrier,tracking_number,status,created_at,updated_at from pickups where return_id=?",id));
    var recs=jdbc.query("select rec.id,rec.warehouse_id,w.code as warehouse_code,rec.location_id,rec.received_by,rec.tracking_number,rec.carrier,rec.package_condition,rec.discrepancy,rec.expected_quantity,rec.received_quantity,rec.notes,rec.created_at from receiving_records rec left join warehouses w on w.id=rec.warehouse_id where rec.return_id=?",(r,n)->map(r),id);
    out.put("receiving",recs.isEmpty()?null:recs.getFirst());
    var insps=jdbc.query("select * from inspections where return_id=?",(r,n)->map(r),id);
    if(insps.isEmpty())out.put("inspection",null);
    else{var io=new LinkedHashMap<String,Object>(insps.getFirst());io.put("findings",jdbc.query("select id,return_item_id,result,product_condition,packaging_condition,quantity,damage_notes from inspection_items where inspection_id=?",(r,n)->map(r),insps.getFirst().get("id")));out.put("inspection",io);}
    out.put("dispositions",jdbc.query("select id,return_item_id,warehouse_id,action,quantity,reason,notes,recovery_value_paise,created_at from dispositions where return_id=? order by created_at asc",(r,n)->map(r),id));
    var refs=jdbc.query("select id,kind,amount_paise,method,status,initiated_at,completed_at from refunds where return_id=?",(r,n)->map(r),id);
    out.put("refund",refs.isEmpty()?null:refs.getFirst());
    out.put("ledger",jdbc.query("select id,type,amount_paise,reason,created_at from store_credit_ledger where reference_type='RETURN' and reference_id=? order by created_at asc",(r,n)->map(r),id));
    out.put("replacements",jdbc.query("select id,order_number,kind,status from orders where source_return_id=?",(r,n)->map(r),id));
    out.put("events",jdbc.query("select id,status,description,created_at from return_events where return_id=? order by created_at asc",(r,n)->map(r),id));
    out.put("documents",jdbc.query("select id,kind,filename,mime,size,created_at from documents where return_id=? order by created_at desc",(r,n)->map(r),id));
    out.put("audit",jdbc.query("select id,actor_id,actor_role,warehouse_id,action,previous_state,new_state,created_at from audit_log where entity_id=? order by created_at asc",(r,n)->map(r),id));
    return out;}
  Map<String,Object> one(String sql,String arg){var x=jdbc.query(sql,(r,n)->map(r),arg);return x.isEmpty()?null:x.getFirst();}

  @GetMapping("/warehouses") Map<String,Object> warehouses(@AuthenticationPrincipal CurrentUser u){admin(u);
    var monthAgo=OffsetDateTime.now(ZoneOffset.UTC).minusDays(30);
    return Map.of("warehouses",jdbc.query("select w.id,w.code,w.name,w.city,w.active::int as active,(select count(*) from users u where u.warehouse_id=w.id and u.role='WAREHOUSE') as operators,(select count(*) from warehouse_tasks t where t.warehouse_id=w.id and t.status in ('TODO','IN_PROGRESS')) as open_tasks,(select count(distinct r.id) from returns r join receiving_records rec on rec.return_id=r.id where rec.warehouse_id=w.id and r.status in ('RECEIVED','INSPECTION')) as pending_returns,(select coalesce(sum(quantity),0) from inventory_buckets b where b.warehouse_id=w.id) as inventory_units,(select count(*) from warehouse_tasks t where t.warehouse_id=w.id and t.status='COMPLETED' and t.completed_at>=?) as resolved_30d from warehouses w order by w.code asc",(r,n)->map(r),monthAgo));}

  @GetMapping("/warehouse-users") Map<String,Object> warehouseUsers(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String search,@RequestParam(required=false) String warehouseId,@RequestParam(required=false) String limit,@RequestParam(required=false) String offset){admin(u);
    var f=new ArrayList<String>();f.add("u.role = 'WAREHOUSE'");var params=new ArrayList<Object>();
    if(opt(search,120)!=null&&!search.isBlank()){String t="%"+search.trim().toLowerCase()+"%";f.add("(lower(u.email) like ? or lower(u.full_name) like ?)");params.add(t);params.add(t);}
    if(opt(warehouseId,80)!=null&&!warehouseId.isBlank()){f.add("u.warehouse_id = ?");params.add(warehouseId);}
    String where="where "+String.join(" AND ",f);
    int total=jdbc.queryForObject("select count(*) from users u "+where,Integer.class,params.toArray());
    var p2=new ArrayList<Object>(params);int lim=limit(limit),off=offset(offset);p2.add(lim);p2.add(off);
    var out=new LinkedHashMap<String,Object>();out.put("users",jdbc.query("select u.id,u.email,u.full_name,u.role,u.warehouse_id,w.code as warehouse_code,u.active::int as active,u.created_at from users u left join warehouses w on w.id=u.warehouse_id "+where+" order by u.created_at desc limit ? offset ?",(r,n)->map(r),p2.toArray()));out.put("total",total);return out;}

  @GetMapping("/workload") Map<String,Object> workload(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String warehouseId,@RequestParam(required=false) String status,@RequestParam(required=false) String priority,@RequestParam(required=false) String assignedTo,@RequestParam(required=false) String from,@RequestParam(required=false) String to,@RequestParam(required=false) String limit,@RequestParam(required=false) String offset){admin(u);
    int lim=limit(limit),off=offset(offset);
    var rf=new ArrayList<String>();var rp=new ArrayList<Object>();
    if(opt(warehouseId,80)!=null&&!warehouseId.isBlank()){rf.add("exists (select 1 from receiving_records rr where rr.return_id=r.id and rr.warehouse_id=?)");rp.add(warehouseId);}
    if(opt(status,40)!=null&&!status.isBlank()&&!"ALL".equals(status)){rf.add("r.status = ?");rp.add(status);}else rf.add("r.status not in ('RESOLVED','CANCELLED','REJECTED')");
    Object fD=dateParam(from),tD=dateParam(to);if(fD!=null){rf.add("r.created_at >= ?");rp.add(fD);}if(tD!=null){rf.add("r.created_at <= ?");rp.add(tD);}
    String rw="where "+String.join(" AND ",rf);
    int returnsTotal=jdbc.queryForObject("select count(*) from returns r "+rw,Integer.class,rp.toArray());
    var rp2=new ArrayList<Object>(rp);rp2.add(lim);rp2.add(off);
    var returns=jdbc.query("select r.id,r.return_number,r.status,(select rr.warehouse_id from receiving_records rr where rr.return_id=r.id) as warehouse_id,r.created_at from returns r "+rw+" order by r.created_at asc limit ? offset ?",(r,n)->map(r),rp2.toArray());
    var tf=new ArrayList<String>();tf.add("1 = 1");var tp=new ArrayList<Object>();
    if(opt(warehouseId,80)!=null&&!warehouseId.isBlank()){tf.add("t.warehouse_id = ?");tp.add(warehouseId);}
    if(opt(status,40)!=null&&!status.isBlank()&&!"ALL".equals(status)){tf.add("t.status = ?");tp.add(status);}
    if(opt(priority,40)!=null&&!priority.isBlank()){tf.add("t.priority = ?");tp.add(priority);}
    if(opt(assignedTo,80)!=null&&!assignedTo.isBlank()){tf.add("t.assigned_to = ?");tp.add(assignedTo);}
    if(fD!=null){tf.add("t.created_at >= ?");tp.add(fD);}if(tD!=null){tf.add("t.created_at <= ?");tp.add(tD);}
    String tw="where "+String.join(" AND ",tf);
    int tasksTotal=jdbc.queryForObject("select count(*) from warehouse_tasks t "+tw,Integer.class,tp.toArray());
    var tp2=new ArrayList<Object>(tp);tp2.add(lim);tp2.add(off);
    var tasks=jdbc.query("select t.id,t.title,t.kind,t.status,t.priority,t.assigned_to,t.due_at,t.warehouse_id from warehouse_tasks t "+tw+" order by t.due_at asc limit ? offset ?",(r,n)->map(r),tp2.toArray());
    return Map.of("returns",returns,"returnsTotal",returnsTotal,"tasks",tasks,"tasksTotal",tasksTotal);}

  @GetMapping("/inventory") Map<String,Object> inventory(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String search,@RequestParam(required=false) String limit,@RequestParam(required=false) String offset){admin(u);
    var f=new ArrayList<String>();var params=new ArrayList<Object>();
    if(opt(search,120)!=null&&!search.isBlank()){String t="%"+search.trim().toLowerCase()+"%";f.add("(lower(p.sku) like ? or lower(p.name) like ?)");params.add(t);params.add(t);}
    String where=f.isEmpty()?"":"where "+String.join(" AND ",f);
    int total=jdbc.queryForObject("select count(*) from products p "+where,Integer.class,params.toArray());
    var p2=new ArrayList<Object>(params);int lim=limit(limit),off=offset(offset);p2.add(lim);p2.add(off);
    var products=jdbc.query("select id,sku,name,image_url,stock from products p "+where+" order by name asc limit ? offset ?",(r,n)->map(r),p2.toArray());
    var ids=new ArrayList<Object>();for(var p:products)ids.add(p.get("id"));
    var buckets=ids.isEmpty()?List.<Map<String,Object>>of():jdbc.query("select b.product_id,b.warehouse_id,w.code as warehouse_code,b.state,b.quantity from inventory_buckets b left join warehouses w on w.id=b.warehouse_id where b.product_id in ("+String.join(",",Collections.nCopies(ids.size(),"?"))+") order by b.state asc",(r,n)->map(r),ids.toArray());
    var out=new ArrayList<Map<String,Object>>();
    for(var p:products){var l=new LinkedHashMap<String,Object>();l.put("product_id",p.get("id"));l.put("sku",p.get("sku"));l.put("name",p.get("name"));String img=(String)p.get("image_url");l.put("image_url",img==null||img.isEmpty()?null:img);l.put("sellable_stock",p.get("stock"));var bl=new ArrayList<Map<String,Object>>();for(var b:buckets)if(p.get("id").equals(b.get("product_id")))bl.add(b);l.put("buckets",bl);out.add(l);}
    return Map.of("inventory",out,"total",total);}

  @GetMapping("/inventory/movements") Map<String,Object> movements(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String warehouseId,@RequestParam(required=false) String productId,@RequestParam(required=false) String reason,@RequestParam(required=false) String limit,@RequestParam(required=false) String offset){admin(u);
    var f=new ArrayList<String>();var params=new ArrayList<Object>();
    if(opt(warehouseId,80)!=null&&!warehouseId.isBlank()){f.add("m.warehouse_id = ?");params.add(warehouseId);}
    if(opt(productId,80)!=null&&!productId.isBlank()){f.add("m.product_id = ?");params.add(productId);}
    if(opt(reason,40)!=null&&!reason.isBlank()){f.add("m.reason = ?");params.add(reason);}
    String where=f.isEmpty()?"":"where "+String.join(" AND ",f);
    int total=jdbc.queryForObject("select count(*) from inventory_movements m "+where,Integer.class,params.toArray());
    var p2=new ArrayList<Object>(params);int lim=limit(limit),off=offset(offset);p2.add(lim);p2.add(off);
    var out=new LinkedHashMap<String,Object>();out.put("movements",jdbc.query("select m.id,m.warehouse_id,w.code as warehouse_code,m.product_id,m.sku,m.quantity,m.from_state,m.to_state,m.reason,m.reference_type,m.reference_id,m.operator_id,m.created_at from inventory_movements m left join warehouses w on w.id=m.warehouse_id "+where+" order by m.created_at desc,m.id desc limit ? offset ?",(r,n)->map(r),p2.toArray()));out.put("total",total);return out;}

  @GetMapping("/analytics") Map<String,Object> analytics(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String windowDays,@RequestParam(required=false) String warehouseId){admin(u);
    int w=32;if(windowDays!=null){try{w=Integer.parseInt(windowDays);bad(w<1||w>365,"Invalid windowDays");}catch(ApiException e){throw e;}catch(Exception e){throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid windowDays");}}
    return analytics(w,opt(warehouseId,80));}

  Map<String,Object> analytics(int windowDays,String warehouseId){
    if(warehouseId!=null&&!warehouseId.isBlank())return siteAnalytics(warehouseId,windowDays);
    var since=OffsetDateTime.now(ZoneOffset.UTC).minusHours((long)windowDays*24);
    var agg=jdbc.queryForObject("select count(*) as orders,coalesce(sum(subtotal_paise),0) as revenue from orders where created_at>=?",(rs,n)->Map.of("orders",rs.getInt(1),"revenue",rs.getInt(2)),since);
    int orders=(int)agg.get("orders"),revenue=(int)agg.get("revenue");
    int vol=jdbc.queryForObject("select count(*) from returns where created_at>=?",Integer.class,since);
    var out=new LinkedHashMap<String,Object>();out.put("scope","global");out.put("warehouseId",null);out.put("windowDays",windowDays);
    var commerce=new LinkedHashMap<String,Object>();commerce.put("orders",orders);commerce.put("revenuePaise",revenue);commerce.put("averageOrderPaise",orders==0?null:Math.round((double)revenue/orders));commerce.put("byStatus",jdbc.query("select status,count(*) as count from orders where created_at>=? group by status order by count desc",(r,n)->map(r),since));out.put("commerce",commerce);
    var returns=new LinkedHashMap<String,Object>();returns.put("volume",vol);returns.put("rate",orders==0?null:Math.round((double)vol/orders*1000)/1000.0);returns.put("byReason",jdbc.query("select ri.reason_code as reason,count(*) as count from return_items ri join returns r on r.id=ri.return_id where r.created_at>=? group by reason order by count desc",(r,n)->map(r),since));returns.put("byResolution",jdbc.query("select resolution_type as resolution,count(*) as count from returns where created_at>=? group by resolution order by count desc",(r,n)->map(r),since));returns.put("averageReceiveToResolutionHours",avgH(jdbc.query("select extract(epoch from (r.updated_at-rec.created_at))/3600.0 as h from returns r join receiving_records rec on rec.return_id=r.id where r.status='RESOLVED' and r.updated_at>=?",(r,n)->r.getObject(1),since)));out.put("returns",returns);
    var refunds=new LinkedHashMap<String,Object>();refunds.put("count",jdbc.queryForObject("select count(*) from refunds where status='COMPLETED' and completed_at>=?",Integer.class,since));refunds.put("amountPaise",jdbc.queryForObject("select coalesce(sum(amount_paise),0) from refunds where status='COMPLETED' and completed_at>=?",Integer.class,since));refunds.put("pending",count("refunds","status = 'PENDING'"));out.put("refunds",refunds);
    var credit=new LinkedHashMap<String,Object>();credit.put("issuedPaise",jdbc.queryForObject("select coalesce(sum(amount_paise),0) from store_credit_ledger where type='CREDIT' and created_at>=?",Integer.class,since));credit.put("usedPaise",jdbc.queryForObject("select coalesce(sum(-amount_paise),0) from store_credit_ledger where type='DEBIT' and created_at>=?",Integer.class,since));credit.put("outstandingPaise",jdbc.queryForObject("select coalesce(sum(amount_paise),0) from store_credit_ledger",Integer.class));out.put("credit",credit);
    var inv=new LinkedHashMap<String,Object>();inv.put("available",jdbc.queryForObject("select coalesce(sum(quantity),0) from inventory_buckets where state='AVAILABLE'",Integer.class));inv.put("returned",jdbc.queryForObject("select coalesce(sum(quantity),0) from inventory_buckets where state='RETURNED'",Integer.class));inv.put("damaged",jdbc.queryForObject("select coalesce(sum(quantity),0) from inventory_buckets where state='DAMAGED'",Integer.class));inv.put("restockedUnits",jdbc.queryForObject("select coalesce(sum(quantity),0) from inventory_movements where reason='RESTOCK' and created_at>=?",Integer.class,since));inv.put("movements",countP("inventory_movements","created_at >= ?",since));out.put("inventory",inv);
    var ware=new LinkedHashMap<String,Object>();ware.put("averageReceiveToInspectionHours",avgH(jdbc.query("select extract(epoch from (i.started_at-rec.created_at))/3600.0 as h from inspections i join receiving_records rec on rec.return_id=i.return_id where i.started_at>=?",(r,n)->r.getObject(1),since)));ware.put("averageInspectionMinutes",avgH(jdbc.query("select extract(epoch from (completed_at-started_at))/60.0 as h from inspections where completed_at is not null and completed_at>=?",(r,n)->r.getObject(1),since)));ware.put("pendingWorkload",count("returns","status in ('RECEIVED','INSPECTION')"));ware.put("overdueTasks",countP("warehouse_tasks","status in ('TODO','IN_PROGRESS') and due_at < ?",OffsetDateTime.now(ZoneOffset.UTC)));out.put("warehouse",ware);
    var rec=new LinkedHashMap<String,Object>();rec.put("valuePaise",jdbc.queryForObject("select coalesce(sum(recovery_value_paise),0) from dispositions where created_at>=?",Integer.class,since));rec.put("byAction",jdbc.query("select action,count(*) as count,coalesce(sum(quantity),0) as quantity from dispositions where created_at>=? group by action order by count desc",(r,n)->map(r),since));out.put("recovery",rec);
    int distinct=jdbc.queryForObject("select count(distinct customer_id) from orders where created_at>=?",Integer.class,since);
    var cust=new LinkedHashMap<String,Object>();cust.put("newCustomers",countP("users","role = 'CUSTOMER' and created_at >= ?",since));cust.put("activeCustomers",distinct);cust.put("ordersPerCustomer",distinct==0||orders==0?null:Math.round((double)orders/distinct*100)/100.0);cust.put("returnsActive",countP("returns","status not in ('RESOLVED','CANCELLED','REJECTED') and created_at >= ?",since));out.put("customers",cust);
    out.put("warnings",jdbc.query("select action,count(*) as count from audit_log where action like 'WARNING_%' and created_at>=? group by action order by count desc",(r,n)->map(r),since));
    var sites=jdbc.query("select id,code from warehouses order by code asc",(r,n)->map(r));
    var byWh=new ArrayList<Map<String,Object>>();
    for(var s:sites){var e=new LinkedHashMap<String,Object>();e.put("warehouseId",s.get("id"));e.put("code",s.get("code"));e.put("returns",jdbc.queryForObject("select count(*) from returns where id in (select return_id from receiving_records where warehouse_id=?) and created_at>=?",Integer.class,s.get("id"),since));e.put("tasks",jdbc.queryForObject("select count(*) from warehouse_tasks where warehouse_id=? and created_at>=?",Integer.class,s.get("id"),since));e.put("inventoryUnits",jdbc.queryForObject("select coalesce(sum(quantity),0) from inventory_buckets where warehouse_id=?",Integer.class,s.get("id")));byWh.add(e);}
    out.put("byWarehouse",byWh);return out;
  }
  static Double avgH(List<Object> vals){var nums=new ArrayList<Double>();for(var v:vals)if(v!=null)nums.add(((Number)v).doubleValue());if(nums.isEmpty())return null;double s=0;for(var d:nums)s+=d;return Math.round(s/nums.size()*10)/10.0;}
  Map<String,Object> siteAnalytics(String warehouseId,int windowDays){
    var site=wh.siteAnalytics(warehouseId,windowDays);
    var out=new LinkedHashMap<String,Object>();out.put("scope","warehouse");out.put("warehouseId",warehouseId);out.put("windowDays",windowDays);
    var commerce=new LinkedHashMap<String,Object>();commerce.put("orders",0);commerce.put("revenuePaise",0);commerce.put("averageOrderPaise",null);commerce.put("byStatus",List.of());out.put("commerce",commerce);
    var returns=new LinkedHashMap<String,Object>();returns.put("volume",0);returns.put("rate",null);returns.put("byReason",List.of());returns.put("byResolution",List.of());returns.put("averageReceiveToResolutionHours",site.get("averageReceiveToResolutionHours"));out.put("returns",returns);
    var refunds=new LinkedHashMap<String,Object>();refunds.put("count",0);refunds.put("amountPaise",0);refunds.put("pending",0);out.put("refunds",refunds);
    var credit=new LinkedHashMap<String,Object>();credit.put("issuedPaise",0);credit.put("usedPaise",0);credit.put("outstandingPaise",0);out.put("credit",credit);
    var inv=new LinkedHashMap<String,Object>();inv.put("available",0);inv.put("returned",0);inv.put("damaged",site.get("damagedUnits"));inv.put("restockedUnits",site.get("restockedUnits"));int movs=0;for(var m:(List<Map<String,Object>>)site.get("movementsByReason"))movs+=((Number)m.get("count")).intValue();inv.put("movements",movs);out.put("inventory",inv);
    var ware=new LinkedHashMap<String,Object>();ware.put("averageReceiveToInspectionHours",site.get("averageReceiveToInspectionHours"));ware.put("averageInspectionMinutes",site.get("averageInspectionMinutes"));ware.put("pendingWorkload",((Number)site.get("pendingInspection")).intValue()+((Number)site.get("pendingDisposition")).intValue());ware.put("overdueTasks",site.get("overdueTasks"));out.put("warehouse",ware);
    var rec=new LinkedHashMap<String,Object>();rec.put("valuePaise",site.get("recoveryValuePaise"));rec.put("byAction",site.get("dispositionsByAction"));out.put("recovery",rec);
    var customers=new LinkedHashMap<String,Object>();customers.put("newCustomers",0);customers.put("activeCustomers",0);customers.put("ordersPerCustomer",null);customers.put("returnsActive",0);out.put("customers",customers);
    out.put("warnings",site.get("warnings"));out.put("byWarehouse",List.of());return out;
  }

  @GetMapping("/refunds") Map<String,Object> refunds(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String search,@RequestParam(required=false) String status,@RequestParam(required=false) String kind,@RequestParam(required=false) String limit,@RequestParam(required=false) String offset){admin(u);
    var f=new ArrayList<String>();var params=new ArrayList<Object>();
    if(opt(search,120)!=null&&!search.isBlank()){String t="%"+search.trim().toLowerCase()+"%";f.add("(lower(r.return_number) like ? or lower(o.order_number) like ? or lower(u.email) like ?)");params.add(t);params.add(t);params.add(t);}
    if(opt(status,40)!=null&&!status.isBlank()){f.add("f.status = ?");params.add(status);}
    if(opt(kind,40)!=null&&!kind.isBlank()){f.add("f.kind = ?");params.add(kind);}
    String where=f.isEmpty()?"":"where "+String.join(" AND ",f);
    String from="from refunds f join returns r on r.id=f.return_id left join orders o on o.id=r.order_id join users u on u.id=r.customer_id";
    int total=jdbc.queryForObject("select count(*) "+from+" "+where,Integer.class,params.toArray());
    var p2=new ArrayList<Object>(params);int lim=limit(limit),off=offset(offset);p2.add(lim);p2.add(off);
    var out=new LinkedHashMap<String,Object>();out.put("refunds",jdbc.query("select f.id,f.return_id,r.return_number,r.order_id,o.order_number,r.customer_id,u.email as customer_email,f.kind,f.amount_paise,f.method,f.status,f.initiated_at,f.completed_at "+from+" "+where+" order by r.created_at desc limit ? offset ?",(r,n)->map(r),p2.toArray()));out.put("total",total);return out;}

  @GetMapping("/refunds/{id}") Map<String,Object> refundDetail(@AuthenticationPrincipal CurrentUser u,@PathVariable String id){admin(u);
    var rows=jdbc.query("select f.id,f.return_id,r.return_number,r.order_id,o.order_number,r.customer_id,u.email as customer_email,f.kind,f.amount_paise,f.method,f.status,f.initiated_at,f.completed_at from refunds f join returns r on r.id=f.return_id left join orders o on o.id=r.order_id join users u on u.id=r.customer_id where f.id=?",(r,n)->map(r),id);
    if(rows.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"REFUND_NOT_FOUND","Refund not found");
    return Map.of("refund",rows.getFirst());}

  @GetMapping("/credit/ledger") Map<String,Object> ledger(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String userId,@RequestParam(required=false) String type,@RequestParam(required=false) String referenceType,@RequestParam(required=false) String limit,@RequestParam(required=false) String offset){admin(u);
    if(type!=null&&!Set.of("CREDIT","DEBIT","ADJUSTMENT").contains(type))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid type");
    var f=new ArrayList<String>();var params=new ArrayList<Object>();
    if(opt(userId,80)!=null&&!userId.isBlank()){f.add("l.user_id = ?");params.add(userId);}
    if(type!=null){f.add("l.type = ?");params.add(type);}
    if(opt(referenceType,40)!=null&&!referenceType.isBlank()){f.add("l.reference_type = ?");params.add(referenceType);}
    String where=f.isEmpty()?"":"where "+String.join(" AND ",f);
    int total=jdbc.queryForObject("select count(*) from store_credit_ledger l "+where,Integer.class,params.toArray());
    var p2=new ArrayList<Object>(params);int lim=limit(limit),off=offset(offset);p2.add(lim);p2.add(off);
    var out=new LinkedHashMap<String,Object>();out.put("entries",jdbc.query("select l.id,l.user_id,l.type,l.amount_paise,l.reason,l.reference_type,l.reference_id,l.created_at,u.email as user_email from store_credit_ledger l join users u on u.id=l.user_id "+where+" order by l.created_at desc,l.id desc limit ? offset ?",(r,n)->map(r),p2.toArray()));out.put("total",total);return out;}

  @GetMapping("/credit/balances") Map<String,Object> balances(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String limit){admin(u);
    int lim=limit(limit);
    return Map.of("balances",jdbc.query("select l.user_id,u.email as user_email,sum(l.amount_paise) as balance_paise from store_credit_ledger l join users u on u.id=l.user_id group by l.user_id,u.email having sum(l.amount_paise) != 0 order by abs(sum(l.amount_paise)) desc limit ?",(r,n)->map(r),lim));}
}
