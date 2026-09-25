package com.returnos.returns;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.stereotype.Service;

/**
 * The sole financial-resolution path. Warehouse and admin callers must use this service.
 * Mirrors TS resolveReturnAtResolved: idempotent no-op once resolved or refunded,
 * applies the payout, then flips the return to RESOLVED itself. Approval gating
 * lives in the callers, not here.
 */
@Service public class ReturnService {
  private final JdbcTemplate jdbc; private final ObjectMapper json;
  public ReturnService(JdbcTemplate jdbc,ObjectMapper json){this.jdbc=jdbc;this.json=json;}
  @Transactional public void resolveReturnAtResolved(String returnId) {
    var r=jdbc.query("select id,customer_id,return_number,resolution_type,status from returns where id=? for update",(rs,n)-> {
      var x=new LinkedHashMap<String,Object>(); x.put("id",rs.getString("id")); x.put("customer",rs.getString("customer_id")); x.put("number",rs.getString("return_number")); x.put("resolution",rs.getString("resolution_type")); x.put("status",rs.getString("status")); return x;
    },returnId);
    if(r.isEmpty())return; var ret=r.getFirst();
    if("RESOLVED".equals(ret.get("status")))return;
    var refunds=jdbc.query("select kind,amount_paise,status from refunds where return_id=?",(rs,n)->{var m=new LinkedHashMap<String,Object>();m.put("kind",rs.getString(1));m.put("amount",rs.getInt(2));m.put("status",rs.getString(3));return m;},returnId);
    var refund=refunds.isEmpty()?null:refunds.getFirst();
    if(refund!=null&&("COMPLETED".equals(refund.get("status"))||"CANCELLED".equals(refund.get("status"))))return;
    String kind=refund!=null?(String)refund.get("kind"):(String)ret.get("resolution");
    if(kind==null)kind=(String)ret.get("resolution");
    var t=OffsetDateTime.now(ZoneOffset.UTC);
    if(refund!=null&&"STORE_CREDIT".equals(kind)){
      int amount=((Number)refund.get("amount")).intValue();
      if(amount>0)jdbc.update("insert into store_credit_ledger(id,user_id,type,amount_paise,reason,reference_type,reference_id) values(?,?, 'CREDIT',?,'Store credit from return '||?, 'RETURN',?) on conflict(reference_type,reference_id) do nothing",UUID.randomUUID().toString(),ret.get("customer"),amount,ret.get("number"),returnId);
      jdbc.update("update refunds set status='COMPLETED',completed_at=? where return_id=?",t,returnId);
    } else if(refund!=null&&("REPLACEMENT".equals(kind)||"EXCHANGE".equals(kind))) createReplacement(ret,kind,t);
    else if(refund!=null) jdbc.update("update refunds set status='COMPLETED',completed_at=? where return_id=?",t,returnId);
    jdbc.update("update returns set status='RESOLVED',updated_at=? where id=?",t,returnId);
    jdbc.update("insert into return_events(id,return_id,status,description) values(?,?, 'RESOLVED','Return resolved')",UUID.randomUUID().toString(),returnId);
    jdbc.update("insert into notifications(id,user_id,return_id,type,title,body) values(?,?,?, 'RETURN_RESOLVED','Return resolved','Return '||?||' was resolved.')",UUID.randomUUID().toString(),ret.get("customer"),returnId,ret.get("number"));
  }
  private void createReplacement(Map<String,Object> ret,String kind,OffsetDateTime t){
    String returnId=(String)ret.get("id");
    if(jdbc.queryForObject("select count(*) from orders where source_return_id=?",Integer.class,returnId)>0)return;
    var year=String.valueOf(t.getYear());
    jdbc.update("insert into order_counter(year,last_seq) values(?,0) on conflict do nothing",year);
    int seq=jdbc.queryForObject("update order_counter set last_seq=last_seq+1 where year=? returning last_seq",Integer.class,year);
    String number="ORD-"+year+"-"+String.format("%04d",seq);
    String tracking="TRK"+UUID.randomUUID().toString().replace("-","").substring(0,12).toUpperCase();
    String id=UUID.randomUUID().toString();
    jdbc.update("insert into orders(id,order_number,customer_id,status,subtotal_paise,shipping_address,payment_status,payment_method,carrier,tracking_number,kind,source_return_id,credit_used_paise,shipping_paise,discount_paise,estimated_delivery) values(?,?,?,'PROCESSING',0,null,'PAID','TEST','ReturnOS Logistics',?,?,?,0,0,0,?)",id,number,ret.get("customer"),tracking,kind,returnId,t.plusDays(5).toString());
    for(var line:jdbc.query("select order_item_id,quantity from return_items where return_id=?",(rs,n)->{var m=new LinkedHashMap<String,Object>();m.put("orderItem",rs.getString(1));m.put("qty",rs.getInt(2));return m;},returnId)){
      var src=jdbc.query("select product_id,sku,product_name,product_image_url from order_items where id=?",(rs,n)->{var m=new LinkedHashMap<String,Object>();m.put("p",rs.getString(1));m.put("sku",rs.getString(2));m.put("name",rs.getString(3));m.put("img",rs.getString(4));return m;},line.get("orderItem")).stream().findFirst().orElse(null);
      if(src==null)continue;
      jdbc.update("insert into order_items(id,order_id,product_id,sku,product_name,product_image_url,quantity,unit_price_paise,line_total_paise) values(?,?,?,?,?,?,?,0,0)",UUID.randomUUID().toString(),id,src.get("p"),src.get("sku"),src.get("name"),src.get("img"),line.get("qty"));
    }
    String site=jdbc.query("select warehouse_id from receiving_records where return_id=?",(rs,n)->rs.getString(1),returnId).stream().findFirst().orElse(null);
    String shipSite=site!=null?site:"wh-blr-01";
    if(site==null){
      var meta=new LinkedHashMap<String,Object>();meta.put("reason","Replacement resolved without a receiving record; shipped from the default warehouse");meta.put("returnId",returnId);meta.put("returnNumber",ret.get("number"));meta.put("orderId",id);
      audit(null,"SYSTEM",shipSite,"WARNING_RESOLUTION_WAREHOUSE_FALLBACK","RETURN",returnId,meta);
    }
    for(var ship:jdbc.query("select oi.product_id as p,sum(ri.quantity) as q from return_items ri join order_items oi on oi.id=ri.order_item_id where ri.return_id=? group by oi.product_id",(rs,n)->{var m=new LinkedHashMap<String,Object>();m.put("p",rs.getString(1));m.put("q",rs.getInt(2));return m;},returnId)){
      int qty=((Number)ship.get("q")).intValue();
      if(jdbc.update("update products set stock=stock-?,updated_at=? where id=? and stock>=?",qty,t,ship.get("p"),qty)==0){
        var meta=new LinkedHashMap<String,Object>();meta.put("reason","Replacement shipment required more sellable units than products.stock held");meta.put("returnId",returnId);meta.put("returnNumber",ret.get("number"));meta.put("productId",ship.get("p"));meta.put("requested",qty);meta.put("orderId",id);
        audit(null,"SYSTEM",shipSite,"WARNING_REPLACEMENT_SHORTFALL","ORDER",id,meta);
        continue;
      }
      jdbc.update("insert into inventory_buckets(warehouse_id,product_id,state,quantity,updated_at) values(?,?, 'AVAILABLE',0,?) on conflict(warehouse_id,product_id,state) do nothing",shipSite,ship.get("p"),t);
      jdbc.update("update inventory_buckets set quantity=greatest(0,quantity-?),updated_at=? where warehouse_id=? and product_id=? and state='AVAILABLE'",qty,t,shipSite,ship.get("p"));
      String sku=jdbc.queryForObject("select sku from products where id=?",String.class,ship.get("p"));
      jdbc.update("insert into inventory_movements(id,warehouse_id,product_id,sku,quantity,from_state,reason,reference_type,reference_id,created_at) values(?,?,?,?,?,'AVAILABLE','ADJUSTMENT','ORDER',?,?)",UUID.randomUUID().toString(),shipSite,ship.get("p"),sku,qty,id,t);
    }
    jdbc.update("insert into order_events(id,order_id,status,description) values(?,?, 'PROCESSING',?)",UUID.randomUUID().toString(),id,"Replacement order for return "+ret.get("number"));
    jdbc.update("insert into notifications(id,user_id,type,title,body) values(?,?, 'ORDER_PLACED','Replacement order created','Replacement order '||?||' was created for return '||?||'.')",UUID.randomUUID().toString(),ret.get("customer"),number,ret.get("number"));
    jdbc.update("update refunds set status='COMPLETED',completed_at=? where return_id=?",t,returnId);
  }
  void audit(String actorId,String actorRole,String warehouseId,String action,String entityType,String entityId,Map<String,Object> meta){String m=null;try{m=json.writeValueAsString(meta);}catch(Exception e){}jdbc.update("insert into audit_log(id,actor_id,actor_role,warehouse_id,action,entity_type,entity_id,metadata) values(?,?,?,?,?,?,?,?::jsonb)",UUID.randomUUID().toString(),actorId,actorRole,warehouseId,action,entityType,entityId,m);}
}
