package com.returnos.warehouse;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.returnos.common.ApiException;
import com.returnos.returns.ReturnService;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Warehouse engine: receiving, inspection, disposition, inventory, tasks, queue, analytics, audit. */
@Service public class WarehouseService {
  public static final String AVAILABLE = "AVAILABLE";
  private static final Set<String> RECEIVABLE = Set.of("REQUESTED", "APPROVED", "PICKED_UP", "IN_TRANSIT");
  private static final List<String> WORKABLE = List.of("APPROVED", "PICKED_UP", "IN_TRANSIT", "RECEIVED", "INSPECTION");
  private static final Map<String, List<String>> ALLOWED_DISPOSITIONS = Map.of(
    "PASS", List.of("RESTOCK", "RESELL"),
    "DAMAGED", List.of("REPAIR", "RETURN_TO_VENDOR", "RECYCLE", "DISPOSE"),
    "DEFECTIVE", List.of("REPAIR", "RETURN_TO_VENDOR", "RECYCLE", "DISPOSE"),
    "INCOMPLETE", List.of("REPAIR", "RESELL", "RETURN_TO_VENDOR", "DISPOSE"),
    "WRONG_ITEM", List.of("RETURN_TO_VENDOR", "RESELL"),
    "UNSELLABLE", List.of("RECYCLE", "DISPOSE", "RETURN_TO_VENDOR"));
  private static final Map<String, String> DISP_TARGET = Map.of(
    "RESTOCK", "AVAILABLE", "RESELL", "RESALE", "REPAIR", "REPAIR",
    "RETURN_TO_VENDOR", "VENDOR_RETURN", "RECYCLE", "RECYCLE", "DISPOSE", "DISPOSAL");
  private static final Map<String, String> DISP_REASON = Map.of(
    "RESTOCK", "RESTOCK", "RESELL", "RESALE", "REPAIR", "REPAIR",
    "RETURN_TO_VENDOR", "VENDOR_RETURN", "RECYCLE", "RECYCLE", "DISPOSE", "DISPOSAL");
  private static final Map<String, Integer> DEFAULT_SLA = Map.of(
    "RECEIVE_RETURN", 24, "INSPECT_ITEM", 24, "PROCESS_DISPOSITION", 48, "REVIEW_APPROVAL", 8,
    "RESTOCK", 24, "PACKAGE_REPLACEMENT", 48, "PREPARE_EXCHANGE", 48, "VERIFY_SHIPMENT", 12);
  private static final List<String> SEVERITY = List.of("PASS", "INCOMPLETE", "WRONG_ITEM", "DAMAGED", "DEFECTIVE", "UNSELLABLE");

  private final JdbcTemplate jdbc; private final ObjectMapper json; private final ReturnService resolutions;
  public WarehouseService(JdbcTemplate jdbc, ObjectMapper json, ReturnService resolutions){this.jdbc=jdbc;this.json=json;this.resolutions=resolutions;}

  static OffsetDateTime now(){return OffsetDateTime.now(ZoneOffset.UTC);}
  static String blankToNull(String s){return s==null||s.isBlank()?null:s;}
  static String iso(Object v){return v==null?null:String.valueOf(v);}
  static Instant instant(Object v){if(v==null)return null;String s=String.valueOf(v).trim().replace(' ','T');try{return OffsetDateTime.parse(s).toInstant();}catch(Exception a){}try{return LocalDateTime.parse(s).toInstant(ZoneOffset.UTC);}catch(Exception b){}try{return Instant.parse(s);}catch(Exception c){}return null;}

  public Map<String,Object> loadReturn(String id){var r=jdbc.query("select * from returns where id=?",(x,n)->map(x),id);if(r.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"RETURN_NOT_FOUND","Return not found");return r.getFirst();}
  void assertReturnSite(String warehouseId,String returnId){var s=jdbc.query("select warehouse_id from receiving_records where return_id=?",(x,n)->x.getString(1),returnId);if(!s.isEmpty()&&!warehouseId.equals(s.getFirst()))throw new ApiException(HttpStatus.NOT_FOUND,"RETURN_NOT_FOUND","Return not found");}
  List<Map<String,Object>> returnItems(String returnId){return jdbc.query("select * from return_items where return_id=?",(x,n)->map(x),returnId);}
  Map<String,Object> lineProduct(String returnItemId){var r=jdbc.query("select oi.product_id as \"productId\",oi.sku as sku,oi.product_name as \"productName\" from return_items ri join order_items oi on oi.id=ri.order_item_id where ri.id=?",(x,n)->map(x),returnItemId);if(r.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"RETURN_ITEM_NOT_FOUND","Return item not found");return r.getFirst();}
  void event(String returnId,String status,String desc){jdbc.update("insert into return_events(id,return_id,status,description) values(?,?,?,?)",UUID.randomUUID().toString(),returnId,status,desc);}
  void notify(String userId,String returnId,String type,String title,String body){jdbc.update("insert into notifications(id,user_id,return_id,type,title,body) values(?,?,?,?,?,?)",UUID.randomUUID().toString(),userId,returnId,type,title,body);}
  void audit(String actorId,String actorRole,String warehouseId,String action,String entityType,String entityId,String prev,String next,Map<String,Object> meta){jdbc.update("insert into audit_log(id,actor_id,actor_role,warehouse_id,action,entity_type,entity_id,previous_state,new_state,metadata) values(?,?,?, ?,?,?,?,?::jsonb,?::jsonb,?::jsonb)",UUID.randomUUID().toString(),actorId,actorRole,warehouseId,action,entityType,entityId,jstr(prev),jstr(next),jstr(meta));}
  String jstr(Object v){try{if(v==null)return null;return json.writeValueAsString(v);}catch(Exception e){return null;}}
  Map<String,Object> one(String sql,String arg){var x=jdbc.query(sql,(r,n)->map(r),arg);return x.isEmpty()?null:x.getFirst();}

  @Transactional public Map<String,Object> approveReturn(String opId,String opRole,String warehouseId,String returnId){
    var ret=loadReturn(returnId);assertReturnSite(warehouseId,returnId);
    if("CANCELLED".equals(ret.get("status")))throw new ApiException(HttpStatus.CONFLICT,"RETURN_CANCELLED","A cancelled return cannot be approved");
    if(ret.get("approved_at")!=null)throw new ApiException(HttpStatus.CONFLICT,"ALREADY_APPROVED","This return has already been approved");
    var t=now();jdbc.update("update returns set approved_at=?,approved_by=?,updated_at=? where id=?",t,opId,t,returnId);
    completeTasksFor(returnId,"REVIEW_APPROVAL",opId);
    event(returnId,"APPROVED","Your return was approved.");
    notify((String)ret.get("customer_id"),returnId,"RETURN_STATUS","Return approved","Return "+ret.get("return_number")+" was approved.");
    audit(opId,opRole,warehouseId,"RETURN_APPROVED","RETURN",returnId,"PENDING_APPROVAL","APPROVED",null);
    int outstanding=jdbc.queryForObject("select count(*) from return_items ri where ri.return_id=? and not exists (select 1 from dispositions d where d.return_item_id=ri.id)",Integer.class,returnId);
    var insp=jdbc.query("select completed_at from inspections where return_id=?",(x,n)->x.getObject(1),returnId);
    if(outstanding==0&&!insp.isEmpty()&&insp.getFirst()!=null){
      resolutions.resolveReturnAtResolved(returnId);
      completeTasksFor(returnId,"PROCESS_DISPOSITION",opId);
      audit(opId,opRole,warehouseId,"RETURN_RESOLVED","RETURN",returnId,"INSPECTION","RESOLVED",Map.of("releasedByApproval",true));
    }
    return loadReturn(returnId);
  }
  public int pendingApprovalCount(){return jdbc.queryForObject("select count(*) from returns where approved_at is null and status in ('RECEIVED','INSPECTION')",Integer.class);}

  @Transactional public Map<String,Object> receiveReturn(String opId,String opRole,String warehouseId,String returnId,String packageCondition,String discrepancy,int receivedQty,String tracking,String carrier,String locationId,String notes){
    var ret=loadReturn(returnId);assertReturnSite(warehouseId,returnId);
    if("CANCELLED".equals(ret.get("status")))throw new ApiException(HttpStatus.CONFLICT,"RETURN_CANCELLED","This return was cancelled and cannot be received");
    if(!RECEIVABLE.contains(ret.get("status"))){
      boolean already=!jdbc.query("select id from receiving_records where return_id=?",(x,n)->x.getString(1),(String)ret.get("id")).isEmpty();
      if(already)throw new ApiException(HttpStatus.CONFLICT,"ALREADY_RECEIVED","This return has already been received");
      throw new ApiException(HttpStatus.CONFLICT,"INVALID_RETURN_STATUS","A return at "+ret.get("status")+" cannot be received");
    }
    var items=returnItems((String)ret.get("id"));
    if(items.isEmpty())throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"RETURN_HAS_NO_ITEMS","This return has no items to receive");
    int expected=items.stream().mapToInt(x->((Number)x.get("quantity")).intValue()).sum();
    if(receivedQty>expected)throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"QUANTITY_EXCEEDS_EXPECTED","Expected at most "+expected+" unit(s) but "+receivedQty+" were entered");
    if(receivedQty!=expected&&"NONE".equals(discrepancy))throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"DISCREPANCY_REQUIRED","Expected "+expected+" unit(s) but "+receivedQty+" were received; record a discrepancy");
    var pickup=jdbc.query("select tracking_number,carrier from pickups where return_id=?",(x,n)->{var m=new LinkedHashMap<String,Object>();m.put("t",x.getString(1));m.put("c",x.getString(2));return m;},ret.get("id")).stream().findFirst().orElse(null);
    String pickupTracking=pickup==null?null:(String)pickup.get("t"), pickupCarrier=pickup==null?null:(String)pickup.get("c");
    if(tracking!=null&&!tracking.isBlank()&&pickupTracking!=null&&!pickupTracking.equals(tracking))throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"TRACKING_MISMATCH","Tracking number does not match the shipment expected for this return");
    var t=now();String rid=UUID.randomUUID().toString();
    jdbc.update("insert into receiving_records(id,return_id,warehouse_id,location_id,received_by,tracking_number,carrier,package_condition,discrepancy,expected_quantity,received_quantity,notes) values(?,?,?,?,?,?,?,?,?,?,?,?)",rid,ret.get("id"),warehouseId,blankToNull(locationId),opId,blankToNull(tracking)!=null?tracking:pickupTracking,blankToNull(carrier)!=null?carrier:pickupCarrier,packageCondition,discrepancy,expected,receivedQty,blankToNull(notes));
    for(var item:items){var p=lineProduct((String)item.get("id"));applyMovement(warehouseId,(String)p.get("productId"),((Number)item.get("quantity")).intValue(),null,"RETURNED","RETURN_RECEIVED","RETURN",(String)ret.get("id"),opId,null,blankToNull(locationId));}
    jdbc.update("update returns set status='RECEIVED',updated_at=? where id=?",t,ret.get("id"));
    jdbc.update("update pickups set status='COMPLETED',received_at=?,updated_at=? where return_id=?",t,t,ret.get("id"));
    event((String)ret.get("id"),"RECEIVED","We received your item at our facility.");
    notify((String)ret.get("customer_id"),(String)ret.get("id"),"RETURN_STATUS","Return received","Return "+ret.get("return_number")+" arrived at our facility and is queued for inspection.");
    boolean unapproved=ret.get("approved_at")==null;
    var meta=new LinkedHashMap<String,Object>();meta.put("expectedQuantity",expected);meta.put("receivedQuantity",receivedQty);meta.put("packageCondition",packageCondition);meta.put("discrepancy",discrepancy);meta.put("receivedBeforeApproval",unapproved);
    audit(opId,opRole,warehouseId,"RETURN_RECEIVED","RETURN",(String)ret.get("id"),(String)ret.get("status"),"RECEIVED",meta);
    completeTasksFor((String)ret.get("id"),"RECEIVE_RETURN",opId);
    createTask(warehouseId,"INSPECT_ITEM","Inspect "+ret.get("return_number"),(String)ret.get("id"),null,"NONE".equals(discrepancy)?"NORMAL":"HIGH",null);
    if(unapproved){
      audit(opId,opRole,warehouseId,"WARNING_RECEIVED_BEFORE_APPROVAL","RETURN",(String)ret.get("id"),(String)ret.get("status"),"RECEIVED",Map.of("note","Parcel accepted before the return was approved; resolution is blocked until approval."));
      createTask(warehouseId,"REVIEW_APPROVAL","Approve "+ret.get("return_number")+" (received unapproved)",(String)ret.get("id"),null,"HIGH",null);
    }
    var out=new LinkedHashMap<String,Object>();out.put("receiving",one("select * from receiving_records where id=?",rid));out.put("ret",loadReturn((String)ret.get("id")));return out;
  }

  @Transactional public Map<String,Object> startInspection(String opId,String opRole,String warehouseId,String returnId){
    var ret=loadReturn(returnId);assertReturnSite(warehouseId,returnId);
    var ex=jdbc.query("select * from inspections where return_id=?",(x,n)->map(x),ret.get("id"));
    if(!ex.isEmpty()){if(ex.getFirst().get("completed_at")!=null)throw new ApiException(HttpStatus.CONFLICT,"INSPECTION_COMPLETED","This return has already been inspected");return ex.getFirst();}
    if(!"RECEIVED".equals(ret.get("status")))throw new ApiException(HttpStatus.CONFLICT,"NOT_RECEIVED","A return must be received before it can be inspected");
    var t=now();String iid=UUID.randomUUID().toString();
    jdbc.update("insert into inspections(id,return_id,warehouse_id,inspected_by,started_at) values(?,?,?,?,?)",iid,ret.get("id"),warehouseId,opId,t);
    for(var item:returnItems((String)ret.get("id"))){var p=lineProduct((String)item.get("id"));applyMovement(warehouseId,(String)p.get("productId"),((Number)item.get("quantity")).intValue(),"RETURNED","INSPECTION","INSPECTION_STARTED","RETURN",(String)ret.get("id"),opId,null,null);}
    jdbc.update("update returns set status='INSPECTION',updated_at=? where id=?",t,ret.get("id"));
    event((String)ret.get("id"),"INSPECTION","Our team is inspecting your item.");
    notify((String)ret.get("customer_id"),(String)ret.get("id"),"RETURN_STATUS","Inspection started","Return "+ret.get("return_number")+" is being inspected.");
    startTasksFor((String)ret.get("id"),"INSPECT_ITEM",opId);
    audit(opId,opRole,warehouseId,"INSPECTION_STARTED","RETURN",(String)ret.get("id"),(String)ret.get("status"),"INSPECTION",null);
    return one("select * from inspections where id=?",iid);
  }

  public record Finding(String returnItemId,String result,String productCondition,String packagingCondition,int quantity,String missingComponents,String damageNotes,String serialNumber){}
  @Transactional public Map<String,Object> completeInspection(String opId,String opRole,String warehouseId,String returnId,List<Finding> findings,String notes){
    var ret=loadReturn(returnId);assertReturnSite(warehouseId,returnId);
    var insp=jdbc.query("select * from inspections where return_id=?",(x,n)->map(x),ret.get("id"));
    if(insp.isEmpty())throw new ApiException(HttpStatus.CONFLICT,"INSPECTION_NOT_STARTED","Start the inspection before completing it");
    if(insp.getFirst().get("completed_at")!=null)throw new ApiException(HttpStatus.CONFLICT,"INSPECTION_COMPLETED","This inspection is already complete");
    var items=returnItems((String)ret.get("id"));var byId=new LinkedHashMap<String,Map<String,Object>>();for(var it:items)byId.put((String)it.get("id"),it);
    if(findings.size()!=items.size())throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"INCOMPLETE_INSPECTION","Record a finding for each of the "+items.size()+" returned line(s)");
    var t=now();var seen=new HashSet<String>();String worst="PASS";
    for(var f:findings){
      var item=byId.get(f.returnItemId());if(item==null)throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"INVALID_RETURN_ITEM","A finding does not belong to this return");
      if(!seen.add(f.returnItemId()))throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"DUPLICATE_FINDING","Each returned line takes exactly one finding");
      if(f.quantity()>((Number)item.get("quantity")).intValue())throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"QUANTITY_EXCEEDS_RETURNED","Inspected quantity exceeds the "+item.get("quantity")+" unit(s) returned on this line");
      jdbc.update("insert into inspection_items(id,inspection_id,return_item_id,result,product_condition,packaging_condition,missing_components,damage_notes,serial_number,quantity) values(?,?,?,?,?,?,?,?,?,?)",UUID.randomUUID().toString(),insp.getFirst().get("id"),f.returnItemId(),f.result(),f.productCondition(),f.packagingCondition(),blankToNull(f.missingComponents()),blankToNull(f.damageNotes()),blankToNull(f.serialNumber()),f.quantity());
      if(SEVERITY.indexOf(f.result())>SEVERITY.indexOf(worst))worst=f.result();
    }
    jdbc.update("update inspections set result=?,notes=?,completed_at=? where id=?",worst,blankToNull(notes),t,insp.getFirst().get("id"));
    completeTasksFor((String)ret.get("id"),"INSPECT_ITEM",opId);
    createTask(warehouseId,"PROCESS_DISPOSITION","Disposition "+ret.get("return_number")+" ("+worst+")",(String)ret.get("id"),null,"PASS".equals(worst)?"NORMAL":"HIGH",null);
    event((String)ret.get("id"),"INSPECTION","Inspection completed. Your resolution is being processed.");
    audit(opId,opRole,warehouseId,"INSPECTION_COMPLETED","RETURN",(String)ret.get("id"),"INSPECTION","INSPECTION",Map.of("result",worst,"lines",findings.size()));
    return inspectionDetail((String)ret.get("id"));
  }
  public Map<String,Object> inspectionDetail(String returnId){
    var insp=jdbc.query("select * from inspections where return_id=?",(x,n)->map(x),returnId);
    if(insp.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"INSPECTION_NOT_FOUND","No inspection exists for this return");
    var items=jdbc.query("select * from inspection_items where inspection_id=? order by created_at asc",(x,n)->map(x),insp.getFirst().get("id"));
    var allowed=new LinkedHashMap<String,Object>();for(var it:items)allowed.put((String)it.get("return_item_id"),ALLOWED_DISPOSITIONS.get(it.get("result")));
    var out=new LinkedHashMap<String,Object>();out.put("inspection",insp.getFirst());out.put("items",items);out.put("allowedDispositions",allowed);return out;
  }
  public List<Map<String,Object>> dispositionsFor(String returnId){return jdbc.query("select * from dispositions where return_id=? order by created_at asc",(x,n)->map(x),returnId);}
  public Map<String,Object> receivingFor(String returnId){return one("select * from receiving_records where return_id=?",returnId);}

  @Transactional public Map<String,Object> recordDisposition(String opId,String opRole,String warehouseId,String returnItemId,String action,int quantity,String locationId,String reason,String notes,Integer recoveryPaise){
    var item=jdbc.query("select * from return_items where id=?",(x,n)->map(x),returnItemId);
    if(item.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"RETURN_ITEM_NOT_FOUND","Return item not found");
    var it=item.getFirst();var ret=loadReturn((String)it.get("return_id"));assertReturnSite(warehouseId,(String)it.get("return_id"));
    var insp=jdbc.query("select * from inspections where return_id=?",(x,n)->map(x),ret.get("id"));
    if(insp.isEmpty()||insp.getFirst().get("completed_at")==null)throw new ApiException(HttpStatus.CONFLICT,"INSPECTION_INCOMPLETE","Complete the inspection before disposing of items");
    if(!jdbc.query("select id from dispositions where return_item_id=?",(x,n)->x.getString(1),(String)it.get("id")).isEmpty())throw new ApiException(HttpStatus.CONFLICT,"ALREADY_DISPOSED","This line has already been dispositioned");
    var finding=jdbc.query("select * from inspection_items where inspection_id=? and return_item_id=?",(x,n)->map(x),insp.getFirst().get("id"),it.get("id"));
    if(finding.isEmpty())throw new ApiException(HttpStatus.CONFLICT,"NO_INSPECTION_FINDING","This line was not inspected");
    if(!ALLOWED_DISPOSITIONS.get(finding.getFirst().get("result")).contains(action))throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"DISPOSITION_NOT_ALLOWED",action+" is not permitted for an inspection result of "+finding.getFirst().get("result"));
    if(quantity>((Number)it.get("quantity")).intValue())throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"QUANTITY_EXCEEDS_RETURNED","Disposition quantity exceeds the "+it.get("quantity")+" unit(s) returned on this line");
    var t=now();String did=UUID.randomUUID().toString();var p=lineProduct((String)it.get("id"));
    jdbc.update("insert into dispositions(id,return_item_id,return_id,inspection_id,warehouse_id,location_id,action,quantity,reason,notes,recovery_value_paise,operator_id) values(?,?,?,?,?,?,?,?,?,?,?,?)",did,it.get("id"),ret.get("id"),insp.getFirst().get("id"),warehouseId,blankToNull(locationId),action,quantity,blankToNull(reason),blankToNull(notes),recoveryPaise==null?0:recoveryPaise,opId);
    applyMovement(warehouseId,(String)p.get("productId"),quantity,"INSPECTION",DISP_TARGET.get(action),DISP_REASON.get(action),"RETURN_ITEM",(String)it.get("id"),opId,null,blankToNull(locationId));
    var meta=new LinkedHashMap<String,Object>();meta.put("returnId",ret.get("id"));meta.put("quantity",quantity);meta.put("recoveryValuePaise",recoveryPaise==null?0:recoveryPaise);
    audit(opId,opRole,warehouseId,"DISPOSITION_COMPLETED","RETURN_ITEM",(String)it.get("id"),(String)finding.getFirst().get("result"),action,meta);
    int outstanding=jdbc.queryForObject("select count(*) from return_items ri where ri.return_id=? and not exists (select 1 from dispositions d where d.return_item_id=ri.id)",Integer.class,ret.get("id"));
    boolean resolved=false;boolean approved=ret.get("approved_at")!=null;
    if(outstanding==0&&!approved){
      createTask(warehouseId,"REVIEW_APPROVAL","Approve "+ret.get("return_number")+" to release its resolution",(String)ret.get("id"),null,"URGENT",null);
      audit(opId,opRole,warehouseId,"RESOLUTION_BLOCKED_PENDING_APPROVAL","RETURN",(String)ret.get("id"),"INSPECTION","INSPECTION",Map.of("reason","Return has no approval stamp"));
    }
    if(outstanding==0&&approved){
      resolutions.resolveReturnAtResolved((String)ret.get("id"));
      resolved=true;
      completeTasksFor((String)ret.get("id"),"PROCESS_DISPOSITION",opId);
      audit(opId,opRole,warehouseId,"RETURN_RESOLVED","RETURN",(String)ret.get("id"),"INSPECTION","RESOLVED",Map.of("resolutionType",ret.get("resolution_type")));
    }
    var out=new LinkedHashMap<String,Object>();out.put("disposition",one("select * from dispositions where id=?",did));out.put("returnResolved",resolved);out.put("ret",loadReturn((String)ret.get("id")));return out;
  }

  // ---- inventory engine ----
  @Transactional public Map<String,Object> applyMovement(String warehouseId,String productId,int quantity,String fromState,String toState,String reason,String refType,String refId,String operatorId,String fromLocation,String toLocation){
    if(quantity<=0)throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_QUANTITY","Movement quantity must be a positive whole number");
    if(fromState==null&&toState==null)throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_MOVEMENT","A movement needs a source or a destination");
    var dup=jdbc.query("select * from inventory_movements where reference_type=? and reference_id=? and reason=? and product_id=?",(x,n)->map(x),refType,refId,reason,productId);
    if(!dup.isEmpty())return null;
    var prod=jdbc.query("select id,sku,stock from products where id=?",(x,n)->map(x),productId);
    if(prod.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"PRODUCT_NOT_FOUND","Product not found");
    var t=now();
    if(fromState!=null){
      if(jdbc.update("update inventory_buckets set quantity=quantity-?,updated_at=? where warehouse_id=? and product_id=? and state=? and quantity>=?",quantity,t,warehouseId,productId,fromState,quantity)==0){
        int held=bucketQuantity(warehouseId,productId,fromState);
        throw new ApiException(HttpStatus.CONFLICT,"INSUFFICIENT_INVENTORY","Not enough stock in "+fromState+": "+held+" held, "+quantity+" requested");
      }
    }
    if(toState!=null){
      jdbc.update("insert into inventory_buckets(warehouse_id,product_id,state,quantity,location_id,updated_at) values(?,?,?,?,?,?) on conflict(warehouse_id,product_id,state) do update set quantity=inventory_buckets.quantity+excluded.quantity,location_id=coalesce(excluded.location_id,inventory_buckets.location_id),updated_at=excluded.updated_at",warehouseId,productId,toState,quantity,toLocation,t);
    }
    if(AVAILABLE.equals(toState)&&!AVAILABLE.equals(fromState))jdbc.update("update products set stock=stock+?,updated_at=? where id=?",quantity,t,productId);
    else if(AVAILABLE.equals(fromState)&&!AVAILABLE.equals(toState)){
      if(jdbc.update("update products set stock=stock-?,updated_at=? where id=? and stock>=?",quantity,t,productId,quantity)==0)throw new ApiException(HttpStatus.CONFLICT,"INSUFFICIENT_STOCK","Insufficient sellable stock for "+prod.getFirst().get("sku"));
    }
    String mid=UUID.randomUUID().toString();
    jdbc.update("insert into inventory_movements(id,warehouse_id,product_id,sku,quantity,from_state,to_state,from_location_id,to_location_id,reason,reference_type,reference_id,operator_id) values(?,?,?,?,?,?,?,?,?,?,?,?,?)",mid,warehouseId,productId,prod.getFirst().get("sku"),quantity,fromState,toState,fromLocation,toLocation,reason,refType,refId,operatorId);
    return one("select * from inventory_movements where id=?",mid);
  }
  public int bucketQuantity(String warehouseId,String productId,String state){return jdbc.query("select quantity from inventory_buckets where warehouse_id=? and product_id=? and state=?",(x,n)->x.getInt(1),warehouseId,productId,state).stream().findFirst().orElse(0);}
  public List<Map<String,Object>> listInventory(String warehouseId){
    var products=jdbc.query("select id,sku,name,image_url,stock from products order by name asc",(x,n)->map(x));
    var buckets=jdbc.query("select product_id,state,quantity from inventory_buckets where warehouse_id=?",(x,n)->map(x),warehouseId);
    var byProduct=new LinkedHashMap<String,Map<String,Object>>();
    for(var b:buckets){var states=(Map<String,Object>)byProduct.computeIfAbsent((String)b.get("product_id"),k->new LinkedHashMap<String,Object>());states.put((String)b.get("state"),b.get("quantity"));}
    var out=new ArrayList<Map<String,Object>>();
    for(var p:products){var l=new LinkedHashMap<String,Object>();l.put("productId",p.get("id"));l.put("sku",p.get("sku"));l.put("name",p.get("name"));String img=(String)p.get("image_url");l.put("imageUrl",img==null||img.isEmpty()?null:img);l.put("states",byProduct.getOrDefault(p.get("id"),Map.of()));l.put("sellableStock",p.get("stock"));out.add(l);}
    return out;
  }
  public List<Map<String,Object>> bucketsFor(String warehouseId,String productId){return jdbc.query("select * from inventory_buckets where warehouse_id=? and product_id=? order by state asc",(x,n)->map(x),warehouseId,productId);}
  public Map<String,Object> listMovements(String warehouseId,String productId,String reason,int limit,int offset){
    var f=new ArrayList<String>();f.add("warehouse_id = ?");var params=new ArrayList<Object>();params.add(warehouseId);
    if(productId!=null){f.add("product_id = ?");params.add(productId);}
    if(reason!=null){f.add("reason = ?");params.add(reason);}
    String where=String.join(" AND ",f);
    int total=jdbc.queryForObject("select count(*) from inventory_movements where "+where,Integer.class,params.toArray());
    var p2=new ArrayList<Object>(params);p2.add(limit);p2.add(offset);
    var out=new LinkedHashMap<String,Object>();out.put("movements",jdbc.query("select * from inventory_movements where "+where+" order by created_at desc,id desc limit ? offset ?",(x,n)->map(x),p2.toArray()));out.put("total",total);return out;
  }

  // ---- queue ----
  static final String QUEUE_SELECT="select r.id as \"returnId\",r.return_number as \"returnNumber\",r.order_id as \"orderId\",o.order_number as \"orderNumber\",r.customer_id as \"customerId\",r.status as status,r.resolution_type as \"resolutionType\",r.created_at as \"createdAt\",r.updated_at as \"updatedAt\",(select oi.product_name from return_items ri join order_items oi on oi.id=ri.order_item_id where ri.return_id=r.id limit 1) as \"productName\",(select oi.sku from return_items ri join order_items oi on oi.id=ri.order_item_id where ri.return_id=r.id limit 1) as sku,(select oi.product_image_url from return_items ri join order_items oi on oi.id=ri.order_item_id where ri.return_id=r.id limit 1) as \"imageUrl\",(select sum(ri.quantity) from return_items ri where ri.return_id=r.id) as quantity,(select ri.reason_code from return_items ri where ri.return_id=r.id limit 1) as \"reasonCode\",(select count(*) from return_items ri where ri.return_id=r.id) as \"lineCount\",p.tracking_number as \"trackingNumber\",p.carrier as carrier,rec.created_at as \"receivedAt\",insp.started_at as \"inspectionStartedAt\",insp.completed_at as \"inspectionCompletedAt\",(select count(*) from dispositions d where d.return_id=r.id) as \"dispositionsDone\" from returns r left join orders o on o.id=r.order_id left join pickups p on p.return_id=r.id left join receiving_records rec on rec.return_id=r.id left join inspections insp on insp.return_id=r.id";
  static String siteCondition(){return "(not exists (select 1 from receiving_records rr where rr.return_id=r.id) or exists (select 1 from receiving_records rr where rr.return_id=r.id and rr.warehouse_id=?))";}
  Map<String,Integer> taskSlaHours(){try{var v=jdbc.query("select value::text from settings where key='TASK_SLA_HOURS'",(x,n)->x.getString(1));if(!v.isEmpty()){var m=(Map<String,Object>)json.readValue(v.getFirst(),Map.class);var out=new LinkedHashMap<String,Integer>();for(var e:m.entrySet())out.put(e.getKey(),((Number)e.getValue()).intValue());return out;}}catch(Exception e){}return DEFAULT_SLA;}
  double hoursBetween(Object from,long toMs){var t=instant(iso(from));if(t==null)return 0;return Math.max(0,(toMs-t.toEpochMilli())/3600000.0);}
  String priorityFor(double age,double sla,String reason){double ratio=sla==0?0:age/sla;if(ratio>=1)return "URGENT";if(ratio>=0.75)return "HIGH";if("DEFECTIVE".equals(reason)||"DAMAGED".equals(reason))return "HIGH";if(ratio>=0.4)return "NORMAL";return "LOW";}
  Map<String,Object> decorateQueue(Map<String,Object> row,long nowMs){
    var sla=taskSlaHours();String status=(String)row.get("status");
    double slaHours="RECEIVED".equals(status)?sla.getOrDefault("INSPECT_ITEM",24):"INSPECTION".equals(status)?sla.getOrDefault("PROCESS_DISPOSITION",48):sla.getOrDefault("RECEIVE_RETURN",24);
    double age=hoursBetween(row.get("createdAt"),nowMs);
    var created=instant(iso(row.get("createdAt")));
    var out=new LinkedHashMap<String,Object>(row);
    String cid=(String)row.get("customerId");String suffix=cid==null?"000000":cid.replaceAll("[^a-zA-Z0-9]","");suffix=suffix.length()<=6?suffix:suffix.substring(suffix.length()-6);suffix=suffix.toUpperCase();while(suffix.length()<6)suffix="0"+suffix;
    out.put("customerRef","CUS-"+suffix);
    Number q=(Number)row.get("quantity");out.put("quantity",q==null?0:q.intValue());
    out.put("ageHours",Math.round(age*10)/10.0);
    out.put("priority",priorityFor(age,slaHours,(String)row.get("reasonCode")));
    out.put("slaDueAt",created==null?null:created.plusMillis((long)(slaHours*3600000)).toString());
    out.put("overdue",age>slaHours);
    out.remove("customerId");return out;
  }
  public Map<String,Object> listQueue(String warehouseId,String status,String search,int limit,int offset){
    var f=new ArrayList<String>();f.add(siteCondition());var params=new ArrayList<Object>();params.add(warehouseId);
    if(status!=null&&!"ALL".equals(status)){f.add("r.status = ?");params.add(status);}
    else{f.add("r.status in ('APPROVED','PICKED_UP','IN_TRANSIT','RECEIVED','INSPECTION')");}
    if(search!=null&&!search.isBlank()){String term="%"+search.trim().toLowerCase()+"%";f.add("(lower(r.return_number) like ? or lower(o.order_number) like ? or lower(p.tracking_number) like ? or exists (select 1 from return_items ri join order_items oi on oi.id=ri.order_item_id where ri.return_id=r.id and (lower(oi.sku) like ? or lower(oi.product_name) like ?)))");params.add(term);params.add(term);params.add(term);params.add(term);params.add(term);}
    String where="where "+String.join(" AND ",f);
    int total=jdbc.queryForObject("select count(*) from returns r left join orders o on o.id=r.order_id left join pickups p on p.return_id=r.id "+where,Integer.class,params.toArray());
    var p2=new ArrayList<Object>(params);p2.add(limit);p2.add(offset);
    var rows=jdbc.query(QUEUE_SELECT+" "+where+" order by r.created_at asc limit ? offset ?",(x,n)->map(x),p2.toArray());
    long nowMs=System.currentTimeMillis();var out=new ArrayList<Map<String,Object>>();for(var r:rows)out.add(decorateQueue(r,nowMs));
    return Map.of("returns",out,"total",total);
  }
  public Map<String,Object> queueEntry(String returnId,String warehouseId){
    var rows=jdbc.query(QUEUE_SELECT+" where r.id=?",(x,n)->map(x),returnId);
    if(rows.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"RETURN_NOT_FOUND","Return not found");
    var site=jdbc.query("select warehouse_id from receiving_records where return_id=?",(x,n)->x.getString(1),returnId);
    if(!site.isEmpty()&&!warehouseId.equals(site.getFirst()))throw new ApiException(HttpStatus.NOT_FOUND,"RETURN_NOT_FOUND","Return not found");
    return decorateQueue(rows.getFirst(),System.currentTimeMillis());
  }
  public List<Map<String,Object>> returnLines(String returnId){return jdbc.query("select ri.id as \"returnItemId\",ri.order_item_id as \"orderItemId\",oi.product_id as \"productId\",oi.sku as sku,oi.product_name as \"productName\",oi.product_image_url as \"imageUrl\",ri.quantity as quantity,ri.reason_code as \"reasonCode\",ri.description as description from return_items ri join order_items oi on oi.id=ri.order_item_id where ri.return_id=? order by oi.product_name asc",(x,n)->map(x),returnId);}
  public Map<String,Object> queueCounts(String warehouseId){var out=new LinkedHashMap<String,Object>();for(var r:jdbc.query("select r.status as s,count(*) as c from returns r where r.status!='CANCELLED' and "+siteCondition()+" group by r.status",(x,n)->map(x),warehouseId))out.put((String)r.get("s"),((Number)r.get("c")).intValue());return out;}
  public List<Map<String,Object>> recentReceiving(String warehouseId,int limit){return jdbc.query("select * from receiving_records where warehouse_id=? order by created_at desc limit ?",(x,n)->map(x),warehouseId,limit);}

  // ---- tasks ----
  public Map<String,Object> createTask(String warehouseId,String kind,String title,String returnId,String orderId,String priority,String assignedTo){
    if(returnId!=null){var open=jdbc.query("select * from warehouse_tasks where kind=? and return_id=? and status in ('TODO','IN_PROGRESS')",(x,n)->map(x),kind,returnId);if(!open.isEmpty())return open.getFirst();}
    var t=now();String id=UUID.randomUUID().toString();double sla=taskSlaHours().getOrDefault(kind,24);
    jdbc.update("insert into warehouse_tasks(id,warehouse_id,kind,title,return_id,order_id,priority,status,assigned_to,created_at,due_at) values(?,?,?,?,?,?,?,?,?,?,?)",id,warehouseId,kind,title,returnId,orderId,priority==null?"NORMAL":priority,"TODO",assignedTo,t,t.plusHours((long)sla));
    return one("select * from warehouse_tasks where id=?",id);
  }
  public void completeTasksFor(String returnId,String kind,String actorId){var t=now();jdbc.update("update warehouse_tasks set status='COMPLETED',completed_at=?,started_at=coalesce(started_at,?),assigned_to=coalesce(assigned_to,?) where return_id=? and kind=? and status in ('TODO','IN_PROGRESS')",t,t,actorId,returnId,kind);}
  public void startTasksFor(String returnId,String kind,String actorId){var t=now();jdbc.update("update warehouse_tasks set status='IN_PROGRESS',started_at=coalesce(started_at,?),assigned_to=coalesce(assigned_to,?) where return_id=? and kind=? and status='TODO'",t,actorId,returnId,kind);}
  public int flagOverdueTasks(String warehouseId){
    var t=now();
    var breached=jdbc.query("select id,kind,title,return_id,due_at from warehouse_tasks where warehouse_id=? and status in ('TODO','IN_PROGRESS') and due_at<? and sla_breached_at is null",(x,n)->map(x),warehouseId,t);
    for(var b:breached){
      jdbc.update("update warehouse_tasks set sla_breached_at=? where id=?",t,b.get("id"));
      var meta=new LinkedHashMap<String,Object>();meta.put("kind",b.get("kind"));meta.put("title",b.get("title"));meta.put("returnId",b.get("return_id"));meta.put("dueAt",iso(b.get("due_at")));meta.put("slaHours",taskSlaHours().getOrDefault(b.get("kind"),24));
      audit(null,"SYSTEM",warehouseId,"WARNING_TASK_OVERDUE","TASK",(String)b.get("id"),"WITHIN_SLA","OVERDUE",meta);
    }
    return breached.size();
  }
  Map<String,Object> decorateTask(Map<String,Object> row){var due=instant(iso(row.get("due_at")));double remaining=due==null?0:(due.toEpochMilli()-System.currentTimeMillis())/3600000.0;boolean open="TODO".equals(row.get("status"))||"IN_PROGRESS".equals(row.get("status"));var out=new LinkedHashMap<String,Object>(row);out.put("hoursRemaining",Math.round(remaining*10)/10.0);out.put("overdue",open&&remaining<0);return out;}
  public Map<String,Object> listTasks(String warehouseId,String status,String kind,String assignedTo,Boolean overdueOnly,int limit,int offset){
    flagOverdueTasks(warehouseId);
    var f=new ArrayList<String>();f.add("t.warehouse_id = ?");var params=new ArrayList<Object>();params.add(warehouseId);
    if(status!=null){f.add("t.status = ?");params.add(status);}
    if(kind!=null){f.add("t.kind = ?");params.add(kind);}
    if(assignedTo!=null){f.add("t.assigned_to = ?");params.add(assignedTo);}
    if(Boolean.TRUE.equals(overdueOnly)){f.add("t.status in ('TODO','IN_PROGRESS') and t.due_at < ?");params.add(now());}
    String where=String.join(" AND ",f);
    int total=jdbc.queryForObject("select count(*) from warehouse_tasks t where "+where,Integer.class,params.toArray());
    var p2=new ArrayList<Object>(params);p2.add(limit);p2.add(offset);
    var rows=jdbc.query("select t.*,r.return_number as \"returnNumber\",o.order_number as \"orderNumber\" from warehouse_tasks t left join returns r on r.id=t.return_id left join orders o on o.id=t.order_id where "+where+" order by case t.status when 'IN_PROGRESS' then 0 when 'TODO' then 1 when 'BLOCKED' then 2 else 3 end,t.due_at asc limit ? offset ?",(x,n)->map(x),p2.toArray());
    var out=new ArrayList<Map<String,Object>>();for(var r:rows)out.add(decorateTask(r));
    return Map.of("tasks",out,"total",total);
  }
  @Transactional public Map<String,Object> updateTask(String opId,String opRole,String warehouseId,String taskId,String status,String assignedTo,Boolean assignedSet,String priority,String blockedReason,Boolean blockedSet){
    var task=jdbc.query("select * from warehouse_tasks where id=? and warehouse_id=?",(x,n)->map(x),taskId,warehouseId);
    if(task.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"TASK_NOT_FOUND","Task not found");
    var t0=task.getFirst();
    if("COMPLETED".equals(t0.get("status"))&&status!=null&&!"COMPLETED".equals(status))throw new ApiException(HttpStatus.CONFLICT,"TASK_COMPLETED","A completed task cannot be reopened");
    if("BLOCKED".equals(status)&&(blockedReason==null||blockedReason.isBlank()))throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,"BLOCKED_REASON_REQUIRED","Blocking a task requires a reason");
    var t=now();String next=status==null?(String)t0.get("status"):status;
    String nextAssigned=Boolean.TRUE.equals(assignedSet)?blankToNull(assignedTo):(String)t0.get("assigned_to");
    String nextPriority=priority==null?(String)t0.get("priority"):priority;
    String nextBlocked="BLOCKED".equals(next)?(Boolean.TRUE.equals(blockedSet)?blankToNull(blockedReason):(String)t0.get("blocked_reason")):null;
    jdbc.update("update warehouse_tasks set status=?,assigned_to=?,priority=?,blocked_reason=?,started_at=case when ? in ('IN_PROGRESS','COMPLETED') then coalesce(started_at,?) else started_at end,completed_at=case when ?='COMPLETED' then coalesce(completed_at,?) else null end where id=?",next,nextAssigned,nextPriority,nextBlocked,next,t,next,t,taskId);
    var meta=new LinkedHashMap<String,Object>();meta.put("kind",t0.get("kind"));meta.put("assignedTo",nextAssigned);meta.put("priority",nextPriority);
    audit(opId,opRole,warehouseId,"TASK_UPDATED","TASK",taskId,(String)t0.get("status"),next,meta);
    return one("select * from warehouse_tasks where id=?",taskId);
  }
  public Map<String,Object> taskCounts(String warehouseId){
    flagOverdueTasks(warehouseId);
    var t=now();var dayAgo=t.minusHours(24);
    var r=jdbc.queryForObject("select coalesce(sum(case when status='TODO' then 1 else 0 end),0) as todo,coalesce(sum(case when status='IN_PROGRESS' then 1 else 0 end),0) as ip,coalesce(sum(case when status='BLOCKED' then 1 else 0 end),0) as bl,coalesce(sum(case when status='COMPLETED' and completed_at>=? then 1 else 0 end),0) as ct,coalesce(sum(case when status in ('TODO','IN_PROGRESS') and due_at<? then 1 else 0 end),0) as od from warehouse_tasks where warehouse_id=?", (rs,n)->{var m=new LinkedHashMap<String,Object>();m.put("todo",rs.getInt(1));m.put("ip",rs.getInt(2));m.put("bl",rs.getInt(3));m.put("ct",rs.getInt(4));m.put("od",rs.getInt(5));return m;},dayAgo,t,warehouseId);
    return Map.of("todo",r.get("todo"),"inProgress",r.get("ip"),"blocked",r.get("bl"),"completedToday",r.get("ct"),"overdue",r.get("od"));
  }
  public List<Map<String,Object>> overdueTasks(String warehouseId,int limit){var r=listTasks(warehouseId,null,null,null,true,limit,0);return (List<Map<String,Object>>)r.get("tasks");}

  // ---- shipments ----
  public Map<String,Object> listShipments(int limit,int offset){
    int total=jdbc.queryForObject("select count(*) from pickups",Integer.class);
    var rows=jdbc.query("select r.id as \"returnId\",r.return_number as \"returnNumber\",o.order_number as \"orderNumber\",p.tracking_number as \"trackingNumber\",p.carrier as carrier,p.kind as kind,p.status as \"pickupStatus\",p.date as \"pickupDate\",p.time_window as \"timeWindow\",p.expected_arrival as \"expectedArrival\",p.received_at as \"receivedAt\",r.status as \"returnStatus\" from pickups p join returns r on r.id=p.return_id left join orders o on o.id=r.order_id order by coalesce(p.received_at,p.created_at) desc limit ? offset ?",(x,n)->map(x),limit,offset);
    return Map.of("shipments",rows,"total",total);
  }

  // ---- analytics ----
  public Map<String,Object> warehouseAnalytics(String warehouseId,int windowDays){
    var since=now().minusHours((long)windowDays*24);var nowIso=now();
    int received=jdbc.queryForObject("select count(*) from receiving_records where warehouse_id=? and created_at>=?",Integer.class,warehouseId,since);
    int inspDone=jdbc.queryForObject("select count(*) from inspections where warehouse_id=? and completed_at is not null and completed_at>=?",Integer.class,warehouseId,since);
    int pendingInsp=jdbc.queryForObject("select count(*) from receiving_records rec join returns r on r.id=rec.return_id where rec.warehouse_id=? and not exists (select 1 from inspections i where i.return_id=r.id)",Integer.class,warehouseId);
    int pendingDisp=jdbc.queryForObject("select count(*) from return_items ri join inspections i on i.return_id=ri.return_id where i.warehouse_id=? and i.completed_at is not null and not exists (select 1 from dispositions d where d.return_item_id=ri.id)",Integer.class,warehouseId);
    Double r2i=avgHours(jdbc.query("select extract(epoch from (i.started_at-rec.created_at))/3600.0 as h from inspections i join receiving_records rec on rec.return_id=i.return_id where i.warehouse_id=? and i.started_at>=?",(x,n)->x.getObject(1),warehouseId,since));
    Double inspMin=avgHours(jdbc.query("select extract(epoch from (completed_at-started_at))/60.0 as h from inspections where warehouse_id=? and completed_at is not null and completed_at>=?",(x,n)->x.getObject(1),warehouseId,since));
    Double r2r=avgHours(jdbc.query("select extract(epoch from (r.updated_at-rec.created_at))/3600.0 as h from returns r join receiving_records rec on rec.return_id=r.id where rec.warehouse_id=? and r.status='RESOLVED' and r.updated_at>=?",(x,n)->x.getObject(1),warehouseId,since));
    var dispByAction=jdbc.query("select action,count(*) as count,coalesce(sum(quantity),0) as quantity from dispositions where warehouse_id=? and created_at>=? group by action order by count desc",(x,n)->map(x),warehouseId,since);
    var inspByResult=jdbc.query("select result,count(*) as count from inspections where warehouse_id=? and result is not null and completed_at>=? group by result order by count desc",(x,n)->map(x),warehouseId,since);
    int recovery=jdbc.queryForObject("select coalesce(sum(recovery_value_paise),0) from dispositions where warehouse_id=? and created_at>=?",Integer.class,warehouseId,since);
    var movByReason=jdbc.query("select reason,count(*) as count,coalesce(sum(quantity),0) as quantity from inventory_movements where warehouse_id=? and created_at>=? group by reason order by count desc",(x,n)->map(x),warehouseId,since);
    int restocked=0;for(var m:movByReason)if("RESTOCK".equals(m.get("reason")))restocked=((Number)m.get("quantity")).intValue();
    int damaged=jdbc.query("select coalesce(sum(quantity),0) from inventory_buckets where warehouse_id=? and state='DAMAGED'",(x,n)->x.getInt(1),warehouseId).stream().findFirst().orElse(0);
    int overdue=jdbc.queryForObject("select count(*) from warehouse_tasks where warehouse_id=? and status in ('TODO','IN_PROGRESS') and due_at<?",Integer.class,warehouseId,nowIso);
    var warnings=jdbc.query("select action,count(*) as count from audit_log where warehouse_id=? and action like 'WARNING_%' and created_at>=? group by action order by count desc",(x,n)->map(x),warehouseId,since);
    var out=new LinkedHashMap<String,Object>();out.put("windowDays",windowDays);out.put("returnsReceived",received);out.put("inspectionsCompleted",inspDone);out.put("pendingInspection",pendingInsp);out.put("pendingDisposition",pendingDisp);out.put("averageReceiveToInspectionHours",r2i);out.put("averageInspectionMinutes",inspMin);out.put("averageReceiveToResolutionHours",r2r);out.put("dispositionsByAction",dispByAction);out.put("inspectionsByResult",inspByResult);out.put("recoveryValuePaise",recovery);out.put("restockedUnits",restocked);out.put("damagedUnits",damaged);out.put("movementsByReason",movByReason);out.put("overdueTasks",overdue);out.put("warnings",warnings);return out;
  }
  static int num(Map<String,Object> counts,String k){Object v=counts.get(k);return v==null?0:((Number)v).intValue();}
  static Double avgHours(List<Object> vals){var nums=new ArrayList<Double>();for(var v:vals)if(v!=null)nums.add(((Number)v).doubleValue());if(nums.isEmpty())return null;double s=0;for(var d:nums)s+=d;return Math.round(s/nums.size()*10)/10.0;}

  // ---- summary ----
  public Map<String,Object> summary(String warehouseId){
    var counts=queueCounts(warehouseId);
    int awaiting=num(counts,"APPROVED")+num(counts,"PICKED_UP")+num(counts,"IN_TRANSIT");
    var since=now().minusHours(24);
    int movementsToday=jdbc.queryForObject("select count(*) from inventory_movements where warehouse_id=? and created_at>=?",Integer.class,warehouseId,since);
    var warnings=jdbc.query("select action,count(*) as count from audit_log where warehouse_id=? and action like 'WARNING_%' and created_at>=? group by action",(x,n)->map(x),warehouseId,since);
    long overdueCount=listQueue(warehouseId,null,null,100,0).get("returns") instanceof List<?> l?l.stream().filter(r->Boolean.TRUE.equals(((Map<?,?>)r).get("overdue"))).count():0;
    var out=new LinkedHashMap<String,Object>();
    out.put("awaitingArrival",awaiting);out.put("pendingInspection",num(counts,"RECEIVED"));out.put("inInspection",num(counts,"INSPECTION"));
    out.put("pendingApproval",pendingApprovalCount());out.put("resolved",num(counts,"RESOLVED"));out.put("overdue",(int)overdueCount);
    out.put("movementsToday",movementsToday);out.put("tasks",taskCounts(warehouseId));out.put("overdueTasks",overdueTasks(warehouseId,5));out.put("warnings",warnings);return out;
  }

  // ---- audit reads ----
  public Map<String,Object> listAudit(String warehouseId,String entityType,String entityId,String actorId,int limit,int offset){
    var f=new ArrayList<String>();f.add("warehouse_id = ?");var params=new ArrayList<Object>();params.add(warehouseId);
    if(entityType!=null){f.add("entity_type = ?");params.add(entityType);}
    if(entityId!=null){f.add("entity_id = ?");params.add(entityId);}
    if(actorId!=null){f.add("actor_id = ?");params.add(actorId);}
    String where=String.join(" AND ",f);
    int total=jdbc.queryForObject("select count(*) from audit_log where "+where,Integer.class,params.toArray());
    var p2=new ArrayList<Object>(params);p2.add(limit);p2.add(offset);
    var out=new LinkedHashMap<String,Object>();out.put("entries",jdbc.query("select * from audit_log where "+where+" order by created_at desc,id desc limit ? offset ?",(x,n)->map(x),p2.toArray()));out.put("total",total);return out;
  }
  public List<Map<String,Object>> auditForEntity(String warehouseId,String entityType,String entityId){return jdbc.query("select * from audit_log where warehouse_id=? and entity_type=? and entity_id=? order by created_at asc,id asc",(x,n)->map(x),warehouseId,entityType,entityId);}

  public Map<String,Object> siteAnalytics(String warehouseId,int windowDays){
    var since=now().minusHours((long)windowDays*24);
    var out=new LinkedHashMap<String,Object>();
    out.put("returnsReceived",jdbc.queryForObject("select count(*) from receiving_records where warehouse_id=? and created_at>=?",Integer.class,warehouseId,since));
    out.put("inspectionsCompleted",jdbc.queryForObject("select count(*) from inspections where warehouse_id=? and completed_at is not null and completed_at>=?",Integer.class,warehouseId,since));
    out.put("pendingInspection",jdbc.queryForObject("select count(*) from receiving_records rec join returns r on r.id=rec.return_id where rec.warehouse_id=? and not exists (select 1 from inspections i where i.return_id=r.id)",Integer.class,warehouseId));
    out.put("pendingDisposition",jdbc.queryForObject("select count(*) from return_items ri join inspections i on i.return_id=ri.return_id where i.warehouse_id=? and i.completed_at is not null and not exists (select 1 from dispositions d where d.return_item_id=ri.id)",Integer.class,warehouseId));
    out.put("averageReceiveToInspectionHours",avgHours(jdbc.query("select extract(epoch from (i.started_at-rec.created_at))/3600.0 as h from inspections i join receiving_records rec on rec.return_id=i.return_id where i.warehouse_id=? and i.started_at>=?",(x,n)->x.getObject(1),warehouseId,since)));
    out.put("averageInspectionMinutes",avgHours(jdbc.query("select extract(epoch from (completed_at-started_at))/60.0 as h from inspections where warehouse_id=? and completed_at is not null and completed_at>=?",(x,n)->x.getObject(1),warehouseId,since)));
    out.put("averageReceiveToResolutionHours",avgHours(jdbc.query("select extract(epoch from (r.updated_at-rec.created_at))/3600.0 as h from returns r join receiving_records rec on rec.return_id=r.id where rec.warehouse_id=? and r.status='RESOLVED' and r.updated_at>=?",(x,n)->x.getObject(1),warehouseId,since)));
    out.put("dispositionsByAction",jdbc.query("select action,count(*) as count,coalesce(sum(quantity),0) as quantity from dispositions where warehouse_id=? and created_at>=? group by action order by count desc",(x,n)->map(x),warehouseId,since));
    out.put("inspectionsByResult",jdbc.query("select result,count(*) as count from inspections where warehouse_id=? and result is not null and completed_at>=? group by result order by count desc",(x,n)->map(x),warehouseId,since));
    out.put("recoveryValuePaise",jdbc.queryForObject("select coalesce(sum(recovery_value_paise),0) from dispositions where warehouse_id=? and created_at>=?",Integer.class,warehouseId,since));
    var movs=jdbc.query("select reason,count(*) as count,coalesce(sum(quantity),0) as quantity from inventory_movements where warehouse_id=? and created_at>=? group by reason order by count desc",(x,n)->map(x),warehouseId,since);
    out.put("movementsByReason",movs);
    int restocked=0;for(var m:movs)if("RESTOCK".equals(m.get("reason")))restocked=((Number)m.get("quantity")).intValue();
    out.put("restockedUnits",restocked);
    out.put("damagedUnits",jdbc.query("select coalesce(sum(quantity),0) from inventory_buckets where warehouse_id=? and state='DAMAGED'",(x,n)->x.getInt(1),warehouseId).stream().findFirst().orElse(0));
    out.put("overdueTasks",jdbc.queryForObject("select count(*) from warehouse_tasks where warehouse_id=? and status in ('TODO','IN_PROGRESS') and due_at<?",Integer.class,warehouseId,now()));
    out.put("warnings",jdbc.query("select action,count(*) as count from audit_log where warehouse_id=? and action like 'WARNING_%' and created_at>=? group by action order by count desc",(x,n)->map(x),warehouseId,since));
    return out;
  }

  static Map<String,Object> map(java.sql.ResultSet r)throws java.sql.SQLException{var x=new LinkedHashMap<String,Object>();var m=r.getMetaData();for(int i=1;i<=m.getColumnCount();i++)x.put(m.getColumnLabel(i),r.getObject(i));return x;}
}
