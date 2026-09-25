package com.returnos.orders;

import com.returnos.common.ApiException;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service public class OrderService {
  public static final String WAREHOUSE="wh-blr-01"; private final JdbcTemplate jdbc; public OrderService(JdbcTemplate jdbc){this.jdbc=jdbc;}
  public Map<String,Object> quote(String user,String address,boolean credit){
    if(jdbc.queryForObject("select count(*) from addresses where id=? and user_id=?",Integer.class,address,user)==0)throw new ApiException(HttpStatus.NOT_FOUND,"ADDRESS_NOT_FOUND","Address not found");var items=cart(user);if(items.isEmpty())throw new ApiException(HttpStatus.BAD_REQUEST,"EMPTY_CART","Cart is empty");
    int subtotal=0, quantity=0;for(var x:items){int q=((Number)x.get("quantity")).intValue(),stock=((Number)x.get("stock")).intValue();if(q>stock)throw new ApiException(HttpStatus.CONFLICT,"INSUFFICIENT_STOCK","Only "+stock+" units available for "+x.get("name"));subtotal+=q*((Number)x.get("pricePaise")).intValue();quantity+=q;}
    int shipping=subtotal>=299900?0:9900,total=subtotal+shipping,balance=jdbc.queryForObject("select coalesce(sum(amount_paise),0) from store_credit_ledger where user_id=?",Integer.class,user),used=credit?Math.min(Math.max(balance,0),total):0;var out=new LinkedHashMap<String,Object>();out.put("addressId",address);out.put("items",items);out.put("subtotalPaise",subtotal);out.put("shippingPaise",shipping);out.put("discountPaise",0);out.put("totalPaise",total);out.put("creditAvailablePaise",balance);out.put("creditToUsePaise",used);out.put("payablePaise",total-used);out.put("totalQuantity",quantity);return out;
  }
  public boolean isReplay(String user,String key){return jdbc.queryForObject("select count(*) from idempotency_keys where key=? and user_id=?",Integer.class,key,user)>0;}
  @Transactional public Map<String,Object> checkout(String user,String address,boolean credit,String key){
    var old=jdbc.query("select user_id,order_id from idempotency_keys where key=? for update",(r,n)->Map.of("user",r.getString(1),"order",r.getString(2)),key);if(!old.isEmpty()){if(!user.equals(old.getFirst().get("user")))throw new ApiException(HttpStatus.CONFLICT,"IDEMPOTENCY_KEY_USED","Idempotency key is already in use");return detail(user,(String)old.getFirst().get("order"));}
    var q=quote(user,address,credit);var id=UUID.randomUUID().toString();for(var x:(List<Map<String,Object>>)q.get("items")){var product=(String)x.get("productId");int amount=((Number)x.get("quantity")).intValue();if(jdbc.update("update products set stock=stock-?,updated_at=now() where id=? and stock>=?",amount,product,amount)==0)throw new ApiException(HttpStatus.CONFLICT,"INSUFFICIENT_STOCK","Insufficient stock for "+x.get("name"));jdbc.update("insert into inventory_buckets(warehouse_id,product_id,state,quantity,updated_at) values(?,?, 'AVAILABLE',0,now()) on conflict(warehouse_id,product_id,state) do nothing",WAREHOUSE,product);jdbc.update("update inventory_buckets set quantity=greatest(0,quantity-?),updated_at=now() where warehouse_id=? and product_id=? and state='AVAILABLE'",amount,WAREHOUSE,product);jdbc.update("insert into inventory_movements(id,warehouse_id,product_id,sku,quantity,from_state,reason,reference_type,reference_id,created_at) values(?,?,?,?,?,'AVAILABLE','ADJUSTMENT','ORDER',?,now())",UUID.randomUUID().toString(),WAREHOUSE,product,x.get("sku"),amount,id);}
    var year=String.valueOf(Year.now(ZoneOffset.UTC).getValue());jdbc.update("insert into order_counter(year,last_seq) values(?,0) on conflict do nothing",year);int seq=jdbc.queryForObject("update order_counter set last_seq=last_seq+1 where year=? returning last_seq",Integer.class,year);String number="ORD-"+year+"-"+String.format("%04d",seq);String tracking="TRK"+UUID.randomUUID().toString().replace("-","").substring(0,12).toUpperCase();jdbc.update("insert into orders(id,order_number,customer_id,status,subtotal_paise,shipping_paise,discount_paise,credit_used_paise,shipping_address,payment_status,payment_method,carrier,tracking_number,kind,estimated_delivery) select ?,?,?, 'PLACED',?,?,?,?,row_to_json(a)::text,'PAID','TEST','ReturnOS Logistics',?,'STANDARD',? from addresses a where a.id=?",id,number,user,q.get("subtotalPaise"),q.get("shippingPaise"),0,q.get("creditToUsePaise"),tracking,OffsetDateTime.now().plusDays(5).toString(),address);
    for(var x:(List<Map<String,Object>>)q.get("items")){int qty=((Number)x.get("quantity")).intValue(),price=((Number)x.get("pricePaise")).intValue();jdbc.update("insert into order_items(id,order_id,product_id,sku,product_name,product_image_url,quantity,unit_price_paise,line_total_paise) values(?,?,?,?,?,?,?,?,?)",UUID.randomUUID().toString(),id,x.get("productId"),x.get("sku"),x.get("name"),x.get("imageUrl"),qty,price,price*qty);}if(((Number)q.get("creditToUsePaise")).intValue()>0)jdbc.update("insert into store_credit_ledger(id,user_id,type,amount_paise,reason,reference_type,reference_id) values(?,?, 'DEBIT',?,'Store credit applied to order '||?, 'ORDER',?)",UUID.randomUUID().toString(),user,-((Number)q.get("creditToUsePaise")).intValue(),number,id);jdbc.update("delete from cart_items where user_id=?",user);jdbc.update("insert into idempotency_keys(key,user_id,order_id) values(?,?,?)",key,user,id);jdbc.update("insert into order_events(id,order_id,status,description) values(?,?, 'PLACED','Order placed by the customer')",UUID.randomUUID().toString(),id);jdbc.update("insert into notifications(id,user_id,type,title,body) values(?,?, 'ORDER_PLACED','Order placed','Order '||?||' was placed.')",UUID.randomUUID().toString(),user,number);return detail(user,id);
  }
  public List<Map<String,Object>> list(String user){var rows=jdbc.query("select * from orders where customer_id=? order by created_at desc",(r,n)->map(r),user);for(var o:rows)enrichOrder(o);return rows;}
  public Map<String,Object> detail(String user,String id){
    var o=jdbc.query("select * from orders where id=? and customer_id=?",(r,n)->map(r),id,user);
    if(o.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"ORDER_NOT_FOUND","Order not found");
    var order=o.getFirst(); enrichOrder(order);
    var items=jdbc.query("select * from order_items where order_id=? order by product_name asc",(r,n)->map(r),id);
    for(var it:items){int up=((Number)it.get("unit_price_paise")).intValue(),lt=((Number)it.get("line_total_paise")).intValue();it.put("unit_price",up/100.0);it.put("line_total",lt/100.0);it.put("unitPricePaise",up);it.put("lineTotalPaise",lt);it.put("productImageUrl",it.get("product_image_url"));}
    int windowDays=settingInt("RETURN_WINDOW_DAYS",30), mindDays=settingInt("CHANGED_MIND_REFUND_DAYS",14);
    String deliveredAt=order.get("delivered_at")==null?null:String.valueOf(order.get("delivered_at"));
    boolean delivered=deliveredAt!=null;
    double daysOld=delivered?daysSince(deliveredAt):Double.POSITIVE_INFINITY;
    boolean withinWindow=delivered&&daysOld<=windowDays;
    List<Map<String,Object>> enriched=new ArrayList<>();
    for(var it:items){
      int qty=((Number)it.get("quantity")).intValue();
      int claimed=jdbc.queryForObject("select coalesce(sum(ri.quantity),0) from return_items ri join returns r on r.id=ri.return_id where ri.order_item_id=? and r.status!='CANCELLED'",Integer.class,it.get("id"));
      int remaining=Math.max(0,qty-claimed);
      boolean eligible=withinWindow&&remaining>0;
      String reason=!eligible?(!delivered?"Available once the order is delivered":(!withinWindow?"Return window expired":"Already returned")):null;
      var e=new LinkedHashMap<String,Object>(it);e.put("remaining_quantity",remaining);e.put("eligible",eligible);e.put("ineligibleReason",reason);enriched.add(e);
    }
    boolean orderEligible=withinWindow&&enriched.stream().anyMatch(e->(boolean)e.get("eligible"));
    String orderReason=!orderEligible?(!delivered?"Available once the order is delivered":(!withinWindow?"Return window expired":"Every item on this order has already been returned")):null;
    var resolutions=new LinkedHashMap<String,Object>();
    for(var reason:jdbc.query("select code from return_reasons where active=true order by sort_order asc,label asc",(r,n)->r.getString(1)))resolutions.put(reason,allowedResolutions(reason,daysOld,mindDays));
    var out=new LinkedHashMap<String,Object>();out.put("order",order);out.put("items",enriched);out.put("eligible",orderEligible);
    out.put("eligibleUntil",delivered?plusDaysIso(deliveredAt,windowDays):null);
    out.put("ineligibleReason",orderReason);out.put("resolutionsByReason",resolutions);return out;
  }
  public Map<String,Object> tracking(String user,String id){var o=jdbc.query("select * from orders where id=? and customer_id=?",(r,n)->map(r),id,user);if(o.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"ORDER_NOT_FOUND","Order not found");var ord=o.getFirst();var t=new LinkedHashMap<String,Object>();t.put("orderNumber",ord.get("order_number"));t.put("status",ord.get("status"));t.put("trackingNumber",ord.get("tracking_number"));t.put("carrier",ord.get("carrier"));t.put("estimatedDelivery",ord.get("estimated_delivery"));t.put("events",jdbc.query("select * from order_events where order_id=? order by created_at asc",(r,n)->map(r),id));return t;}
  /** Legacy rupee fields + camelCase aliases the storefront reads (TS OrderRow shape). */
  static void enrichOrder(Map<String,Object> order){int sub=((Number)order.get("subtotal_paise")).intValue(),ship=((Number)order.get("shipping_paise")).intValue(),disc=((Number)order.get("discount_paise")).intValue(),cred=((Number)order.get("credit_used_paise")).intValue();order.put("subtotal",sub/100.0);order.put("subtotalPaise",sub);order.put("shippingPaise",ship);order.put("discountPaise",disc);order.put("creditUsedPaise",cred);order.put("totalPaise",sub+ship-disc);order.put("shippingAddress",order.get("shipping_address"));order.put("paymentStatus",order.get("payment_status"));order.put("trackingNumber",order.get("tracking_number"));order.put("estimatedDelivery",order.get("estimated_delivery"));}
  private int settingInt(String key,int fallback){try{var v=jdbc.query("select value::text from settings where key=?",(r,n)->r.getString(1),key);if(v.isEmpty())return fallback;return Integer.parseInt(v.getFirst().replace("\"","").trim());}catch(Exception e){return fallback;}}
  private static double daysSince(String iso){var t=parseInstant(iso);return t==null?Double.POSITIVE_INFINITY:(double)(Instant.now().toEpochMilli()-t.toEpochMilli())/86400000;}
  private static String plusDaysIso(String iso,int days){var t=parseInstant(iso);return t==null?null:t.atOffset(ZoneOffset.UTC).plusDays(days).toString();}
  private static Instant parseInstant(String iso){String s=iso.trim().replace(' ','T');try{return OffsetDateTime.parse(s).toInstant();}catch(Exception a){}try{return LocalDateTime.parse(s).toInstant(ZoneOffset.UTC);}catch(Exception b){}try{return Instant.parse(s);}catch(Exception c){}return null;}
  private static List<String> allowedResolutions(String code,double daysOld,int mindDays){
    if("DEFECTIVE".equals(code)||"DAMAGED".equals(code))return List.of("REFUND","REPLACEMENT","EXCHANGE");
    if("CHANGED_MIND".equals(code))return daysOld<=mindDays?List.of("REFUND","STORE_CREDIT"):List.of("STORE_CREDIT");
    return List.of("REFUND","REPLACEMENT","EXCHANGE","STORE_CREDIT");
  }
  private List<Map<String,Object>> cart(String user){var items=jdbc.query("select c.product_id as \"productId\",c.quantity,p.sku,p.name,p.price_paise as \"pricePaise\",nullif(p.image_url,'') as \"imageUrl\",p.stock from cart_items c join products p on p.id=c.product_id where c.user_id=? order by p.name",(r,n)->map(r),user);for(var x:items)x.put("lineTotalPaise",((Number)x.get("quantity")).intValue()*((Number)x.get("pricePaise")).intValue());return items;} private static Map<String,Object> map(java.sql.ResultSet r)throws java.sql.SQLException{var x=new LinkedHashMap<String,Object>();var m=r.getMetaData();for(int i=1;i<=m.getColumnCount();i++)x.put(m.getColumnLabel(i),r.getObject(i));return x;}
}
