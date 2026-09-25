package com.returnos.fulfillment;

import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Demo fulfillment scheduler: advances due orders/returns one stage per tick.
 * Stops carrier automation at IN_TRANSIT for returns — everything after is
 * driven by real warehouse operator actions. Never crashes the loop.
 */
@Service public class FulfillmentService {
  static final List<String> ORDER_STAGES=List.of("PLACED","CONFIRMED","PROCESSING","SHIPPED","IN_TRANSIT","OUT_FOR_DELIVERY","DELIVERED");
  static final List<String> RETURN_STAGES=List.of("REQUESTED","APPROVED","PICKED_UP","IN_TRANSIT","RECEIVED","INSPECTION","RESOLVED");
  static final int LAST_SCHEDULED_RETURN=RETURN_STAGES.indexOf("IN_TRANSIT");
  static final Map<String,String> ORDER_COPY=Map.of("CONFIRMED","Your order was confirmed.","PROCESSING","We are preparing your items for dispatch.","SHIPPED","Your parcel has left our warehouse.","IN_TRANSIT","Your parcel is on its way.","OUT_FOR_DELIVERY","Your parcel is out for delivery today.","DELIVERED","Your parcel was delivered.");
  static final Map<String,String> RETURN_COPY=Map.of("APPROVED","Your return was approved.","PICKED_UP","Your item was collected by the carrier.","IN_TRANSIT","Your item is on its way back to us.");
  static final Map<String,Integer> ORDER_DELAYS=Map.of("CONFIRMED",1,"PROCESSING",2,"SHIPPED",3,"IN_TRANSIT",5,"OUT_FOR_DELIVERY",7,"DELIVERED",8);
  static final Map<String,Integer> RETURN_DELAYS=Map.of("APPROVED",1,"PICKED_UP",2,"IN_TRANSIT",3);

  private final JdbcTemplate jdbc; private final com.returnos.warehouse.WarehouseService warehouse;
  public FulfillmentService(JdbcTemplate jdbc,com.returnos.warehouse.WarehouseService warehouse){this.jdbc=jdbc;this.warehouse=warehouse;}

  static int envMinutes(String name,int fallback){try{String raw=System.getenv(name);if(raw==null||raw.isBlank())return fallback;int n=Integer.parseInt(raw.trim());if(n<0)return fallback;return n;}catch(Exception e){return fallback;}}
  static double minutesSince(Object iso){if(iso==null)return Double.POSITIVE_INFINITY;Instant t=null;try{if(iso instanceof java.sql.Timestamp ts)t=ts.toInstant();else if(iso instanceof OffsetDateTime o)t=o.toInstant();else if(iso instanceof LocalDateTime l)t=l.atZone(ZoneId.systemDefault()).toInstant();else if(iso instanceof java.util.Date d)t=d.toInstant();else{String s=String.valueOf(iso).trim().replace(' ','T');try{t=OffsetDateTime.parse(s).toInstant();}catch(Exception a){}if(t==null)try{t=LocalDateTime.parse(s).atZone(ZoneId.systemDefault()).toInstant();}catch(Exception b){}if(t==null)try{t=Instant.parse(s);}catch(Exception c){}}}catch(Exception e){}if(t==null)return Double.POSITIVE_INFINITY;return (Instant.now().toEpochMilli()-t.toEpochMilli())/60000.0;}

  public void tickFulfillment(){tickOrders();tickReturns();}

  void tickOrders(){
    for(var row:jdbc.query("select id,order_number,customer_id,status from orders where status!='DELIVERED' and status!='CANCELLED'",(r,n)->map(r))){
      int index=ORDER_STAGES.indexOf(row.get("status"));
      if(index<0||index>=ORDER_STAGES.size()-1)continue;
      String next=ORDER_STAGES.get(index+1);
      var last=jdbc.query("select created_at from order_events where order_id=? order by created_at desc limit 1",(r,n)->r.getObject(1),row.get("id")).stream().findFirst().orElse(null);
      if(last==null)last=jdbc.queryForObject("select created_at from orders where id=?",Object.class,row.get("id"));
      if(minutesSince(last)<envMinutes("FULFILL_ORDER_MIN_"+next,ORDER_DELAYS.getOrDefault(next,5)))continue;
      advanceOrder(row,next);
    }
  }
  @Transactional void advanceOrder(Map<String,Object> row,String next){
    var t=OffsetDateTime.now(ZoneOffset.UTC);
    if("DELIVERED".equals(next))jdbc.update("update orders set status=?,delivered_at=? where id=? and status!='DELIVERED'",next,t,row.get("id"));
    else jdbc.update("update orders set status=? where id=?",next,row.get("id"));
    jdbc.update("insert into order_events(id,order_id,status,description) values(?,?,?,?)",UUID.randomUUID().toString(),row.get("id"),next,ORDER_COPY.getOrDefault(next,"Order moved to "+next));
    if("DELIVERED".equals(next))jdbc.update("insert into notifications(id,user_id,type,title,body) values(?,?, 'ORDER_DELIVERED','Order delivered','Order '||?||' was delivered.')",UUID.randomUUID().toString(),row.get("customer_id"),row.get("order_number"));
  }

  void tickReturns(){
    for(var row:jdbc.query("select id,return_number,customer_id,status,updated_at from returns where status!='RESOLVED' and status!='CANCELLED'",(r,n)->map(r))){
      int index=RETURN_STAGES.indexOf(row.get("status"));
      if(index<0||index>=LAST_SCHEDULED_RETURN)continue;
      String next=RETURN_STAGES.get(index+1);
      if(minutesSince(row.get("updated_at"))<envMinutes("FULFILL_RETURN_MIN_"+next,RETURN_DELAYS.getOrDefault(next,5)))continue;
      advanceReturn(row,next);
    }
  }
  @Transactional void advanceReturn(Map<String,Object> row,String next){
    var t=OffsetDateTime.now(ZoneOffset.UTC);String id=(String)row.get("id");
    if("APPROVED".equals(next))jdbc.update("update returns set status=?,updated_at=?,approved_at=coalesce(approved_at,?) where id=?",next,t,t,id);
    else jdbc.update("update returns set status=?,updated_at=? where id=?",next,t,id);
    jdbc.update("insert into return_events(id,return_id,status,description) values(?,?,?,?)",UUID.randomUUID().toString(),id,next,RETURN_COPY.getOrDefault(next,"Return moved to "+next));
    if(!jdbc.query("select id from pickups where return_id=?",(r,n)->r.getString(1),id).isEmpty())
      jdbc.update("update pickups set status=?,updated_at=? where return_id=?","APPROVED".equals(next)?"SCHEDULED":next,t,id);
    if("IN_TRANSIT".equals(next))warehouse.createTask("wh-blr-01","RECEIVE_RETURN","Receive "+row.get("return_number"),id,null,"NORMAL",null);
  }
  static Map<String,Object> map(java.sql.ResultSet r)throws java.sql.SQLException{var x=new LinkedHashMap<String,Object>();var m=r.getMetaData();for(int i=1;i<=m.getColumnCount();i++)x.put(m.getColumnLabel(i),r.getObject(i));return x;}
}

@Component @ConditionalOnProperty(name="returnos.fulfillment-enabled",havingValue="true",matchIfMissing=true)
class FulfillmentScheduler {
  private final FulfillmentService fulfillment;
  FulfillmentScheduler(FulfillmentService fulfillment){this.fulfillment=fulfillment;}
  @Scheduled(fixedDelayString="${returnos.fulfill-tick-ms:60000}")
  void tick(){try{fulfillment.tickFulfillment();}catch(Exception e){org.slf4j.LoggerFactory.getLogger(FulfillmentScheduler.class).error("Fulfillment tick failed",e);}}
}
