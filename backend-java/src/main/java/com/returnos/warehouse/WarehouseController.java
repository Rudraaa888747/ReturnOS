package com.returnos.warehouse;

import com.fasterxml.jackson.databind.JsonNode;
import com.returnos.auth.CurrentUser;
import com.returnos.common.ApiException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/v1/warehouse") public class WarehouseController {
  private static final Set<String> PACKAGE=Set.of("SEALED","OPENED","DAMAGED");
  private static final Set<String> DISCREP=Set.of("NONE","WRONG_ITEM","QUANTITY_MISMATCH","DAMAGED_PACKAGE","MISSING_ITEM");
  private static final Set<String> RESULTS=Set.of("PASS","DAMAGED","DEFECTIVE","INCOMPLETE","WRONG_ITEM","UNSELLABLE");
  private static final Set<String> GRADES=Set.of("NEW","LIKE_NEW","USED","DAMAGED","UNUSABLE");
  private static final Set<String> ACTIONS=Set.of("RESTOCK","RESELL","REPAIR","RETURN_TO_VENDOR","RECYCLE","DISPOSE");
  private static final Set<String> REASONS=Set.of("RETURN_RECEIVED","INSPECTION_STARTED","INSPECTION_COMPLETED","RESTOCK","DAMAGE","REPAIR","RESALE","VENDOR_RETURN","RECYCLE","DISPOSAL","ADJUSTMENT");
  private static final Set<String> KINDS=Set.of("RECEIVE_RETURN","INSPECT_ITEM","PROCESS_DISPOSITION","REVIEW_APPROVAL","RESTOCK","PACKAGE_REPLACEMENT","PREPARE_EXCHANGE","VERIFY_SHIPMENT");
  private static final Set<String> TSTAT=Set.of("TODO","IN_PROGRESS","COMPLETED","BLOCKED");
  private static final Set<String> PRIOR=Set.of("LOW","NORMAL","HIGH","URGENT");

  private final JdbcTemplate jdbc; private final WarehouseService svc;
  WarehouseController(JdbcTemplate jdbc,WarehouseService svc){this.jdbc=jdbc;this.svc=svc;}

  record Op(String id,String role,String warehouseId){}
  Op wh(CurrentUser u){
    if(u==null)throw new ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHORIZED","Authentication required");
    if(!"WAREHOUSE".equals(u.role()))throw new ApiException(HttpStatus.FORBIDDEN,"FORBIDDEN","Warehouse access required");
    if(u.warehouseId()==null||u.warehouseId().isBlank())throw new ApiException(HttpStatus.FORBIDDEN,"NO_WAREHOUSE_ASSIGNED","This account is not assigned to a warehouse");
    var w=jdbc.query("select active from warehouses where id=?",(r,n)->r.getBoolean(1),u.warehouseId());
    if(w.isEmpty()||!w.getFirst())throw new ApiException(HttpStatus.FORBIDDEN,"WAREHOUSE_DISABLED","This warehouse has been disabled");
    return new Op(u.id(),u.role(),u.warehouseId());
  }
  void assertLocation(String warehouseId,String locationId){
    if(locationId==null||locationId.isBlank())return;
    if(jdbc.queryForObject("select count(*) from warehouse_locations where id=? and warehouse_id=? and active=true",Integer.class,locationId,warehouseId)==0)throw new ApiException(HttpStatus.NOT_FOUND,"LOCATION_NOT_FOUND","Location not found in this warehouse");
  }
  void bad(boolean cond,String msg){if(cond)throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR",msg);}
  int limit(String v){if(v==null)return 25;try{int n=Integer.parseInt(v);bad(n<1||n>100,"Invalid limit");return n;}catch(ApiException e){throw e;}catch(Exception e){throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid limit");}}
  int offset(String v){if(v==null)return 0;try{int n=Integer.parseInt(v);bad(n<0,"Invalid offset");return n;}catch(ApiException e){throw e;}catch(Exception e){throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid offset");}}
  int windowDays(String v){if(v==null)return 30;try{int n=Integer.parseInt(v);bad(n<1||n>365,"Invalid windowDays");return n;}catch(ApiException e){throw e;}catch(Exception e){throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid windowDays");}}
  String opt(String v,int max){if(v==null)return null;bad(v.length()>max,"Parameter too long");return v;}
  String enumOpt(String v,Set<String> allowed,String name){if(v==null)return null;if(!allowed.contains(v))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid "+name);return v;}

  record Receive(String packageCondition,String discrepancy,@NotNull @Min(0) Integer receivedQuantity,@Size(max=80) String trackingNumber,@Size(max=80) String carrier,@Size(min=1,max=80) String locationId,@Size(max=2000) String notes){}
  record Finding(@NotBlank String returnItemId,String result,String productCondition,String packagingCondition,@NotNull @Min(1) Integer quantity,@Size(max=500) String missingComponents,@Size(max=2000) String damageNotes,@Size(max=120) String serialNumber){}
  record Complete(@NotEmpty List<@Valid Finding> findings,@Size(max=2000) String notes){}
  record Disposition(@NotBlank String returnItemId,String action,@NotNull @Min(1) Integer quantity,@Size(min=1,max=80) String locationId,@Size(max=500) String reason,@Size(max=2000) String notes,@Min(0) @Max(100000000) Integer recoveryValuePaise){}

  @GetMapping("/me") Map<String,Object> me(@AuthenticationPrincipal CurrentUser u){var o=wh(u);
    var w=jdbc.query("select id,code,name,city from warehouses where id=?",(r,n)->WarehouseService.map(r),o.warehouseId()).getFirst();
    var locs=jdbc.query("select id,code,name,kind from warehouse_locations where warehouse_id=? and active=true order by code asc",(r,n)->WarehouseService.map(r),o.warehouseId());
    var out=new LinkedHashMap<String,Object>();out.put("operator",Map.of("id",o.id(),"role",o.role()));out.put("warehouse",w);out.put("locations",locs);return out;}

  @GetMapping("/returns") Map<String,Object> returns(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String status,@RequestParam(required=false) String search,@RequestParam(required=false) String limit,@RequestParam(required=false) String offset){var o=wh(u);return svc.listQueue(o.warehouseId(),opt(status,40),opt(search,120),limit(limit),offset(offset));}

  @GetMapping("/returns/{id}") Map<String,Object> returnDetail(@AuthenticationPrincipal CurrentUser u,@PathVariable String id){var o=wh(u);
    var hasInsp=!jdbc.query("select id from inspections where return_id=?",(r,n)->r.getString(1),id).isEmpty();
    var out=new LinkedHashMap<String,Object>();
    out.put("summary",svc.queueEntry(id,o.warehouseId()));out.put("lines",svc.returnLines(id));out.put("receiving",svc.receivingFor(id));
    out.put("inspection",hasInsp?svc.inspectionDetail(id):null);out.put("dispositions",svc.dispositionsFor(id));
    out.put("timeline",jdbc.query("select id,status,description,created_at from return_events where return_id=? order by created_at asc",(r,n)->WarehouseService.map(r),id));
    out.put("documents",jdbc.query("select id,kind,filename,mime,size,created_at from documents where return_id=?",(r,n)->WarehouseService.map(r),id));
    out.put("audit",svc.auditForEntity(o.warehouseId(),"RETURN",id));return out;}

  @PostMapping("/returns/{id}/approve") Map<String,Object> approve(@AuthenticationPrincipal CurrentUser u,@PathVariable String id){var o=wh(u);return Map.of("ret",svc.approveReturn(o.id(),o.role(),o.warehouseId(),id));}

  @PostMapping("/returns/{id}/receive") @ResponseStatus(HttpStatus.CREATED) Map<String,Object> receive(@AuthenticationPrincipal CurrentUser u,@PathVariable String id,@Valid @RequestBody Receive b){var o=wh(u);
    if(b.packageCondition()==null||!PACKAGE.contains(b.packageCondition()))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid packageCondition");
    String disc=b.discrepancy()==null?"NONE":b.discrepancy();if(!DISCREP.contains(disc))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid discrepancy");
    assertLocation(o.warehouseId(),b.locationId());
    return svc.receiveReturn(o.id(),o.role(),o.warehouseId(),id,b.packageCondition(),disc,b.receivedQuantity(),b.trackingNumber(),b.carrier(),b.locationId(),b.notes());}

  @PostMapping("/returns/{id}/inspection/start") @ResponseStatus(HttpStatus.CREATED) Map<String,Object> startInspection(@AuthenticationPrincipal CurrentUser u,@PathVariable String id){var o=wh(u);return Map.of("inspection",svc.startInspection(o.id(),o.role(),o.warehouseId(),id));}

  @PostMapping("/returns/{id}/inspection/complete") Map<String,Object> completeInspection(@AuthenticationPrincipal CurrentUser u,@PathVariable String id,@Valid @RequestBody Complete b){var o=wh(u);
    var findings=new ArrayList<WarehouseService.Finding>();
    for(var f:b.findings()){
      if(f.result()==null||!RESULTS.contains(f.result()))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid result");
      if(f.productCondition()==null||!GRADES.contains(f.productCondition()))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid productCondition");
      if(f.packagingCondition()==null||!GRADES.contains(f.packagingCondition()))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid packagingCondition");
      findings.add(new WarehouseService.Finding(f.returnItemId(),f.result(),f.productCondition(),f.packagingCondition(),f.quantity(),f.missingComponents(),f.damageNotes(),f.serialNumber()));
    }
    return svc.completeInspection(o.id(),o.role(),o.warehouseId(),id,findings,b.notes());}

  @PostMapping("/returns/{id}/disposition") @ResponseStatus(HttpStatus.CREATED) Map<String,Object> disposition(@AuthenticationPrincipal CurrentUser u,@PathVariable String id,@Valid @RequestBody Disposition b){var o=wh(u);
    if(b.action()==null||!ACTIONS.contains(b.action()))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid action");
    assertLocation(o.warehouseId(),b.locationId());
    var line=jdbc.query("select return_id from return_items where id=?",(r,n)->r.getString(1),b.returnItemId());
    if(line.isEmpty()||!id.equals(line.getFirst()))throw new ApiException(HttpStatus.NOT_FOUND,"RETURN_ITEM_NOT_FOUND","Return item not found on this return");
    return svc.recordDisposition(o.id(),o.role(),o.warehouseId(),b.returnItemId(),b.action(),b.quantity(),b.locationId(),b.reason(),b.notes(),b.recoveryValuePaise());}

  @GetMapping("/inventory") Map<String,Object> inventory(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String search,@RequestParam(required=false) String status,@RequestParam(required=false) String limit,@RequestParam(required=false) String offset){var o=wh(u);
    limit(limit);offset(offset);
    var lines=svc.listInventory(o.warehouseId());
    if(search!=null&&!search.isBlank()){String term=search.trim().toLowerCase();lines.removeIf(l->!((String)l.get("name")+" "+(String)l.get("sku")).toLowerCase().contains(term));}
    return Map.of("inventory",lines,"total",lines.size());}

  @GetMapping("/inventory/{productId}") Map<String,Object> inventoryDetail(@AuthenticationPrincipal CurrentUser u,@PathVariable String productId){var o=wh(u);
    var p=jdbc.query("select id,sku,name,stock from products where id=?",(r,n)->WarehouseService.map(r),productId);
    if(p.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"PRODUCT_NOT_FOUND","Product not found");
    return Map.of("product",p.getFirst(),"buckets",svc.bucketsFor(o.warehouseId(),productId));}

  @GetMapping("/inventory-movements") Map<String,Object> movements(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String productId,@RequestParam(required=false) String reason,@RequestParam(required=false) String limit,@RequestParam(required=false) String offset,@RequestParam(required=false) String status,@RequestParam(required=false) String search){var o=wh(u);
    if(reason!=null&&!REASONS.contains(reason))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid reason");
    return svc.listMovements(o.warehouseId(),opt(productId,80),reason,limit(limit),offset(offset));}

  @GetMapping("/summary") Map<String,Object> summary(@AuthenticationPrincipal CurrentUser u){return svc.summary(wh(u).warehouseId());}

  @GetMapping("/tasks") Map<String,Object> tasks(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String taskStatus,@RequestParam(required=false) String kind,@RequestParam(required=false) String assignedTo,@RequestParam(required=false) String overdueOnly,@RequestParam(required=false) String limit,@RequestParam(required=false) String offset){var o=wh(u);
    return svc.listTasks(o.warehouseId(),enumOpt(taskStatus,TSTAT,"taskStatus"),enumOpt(kind,KINDS,"kind"),opt(assignedTo,80),"true".equalsIgnoreCase(overdueOnly)||"1".equals(overdueOnly),limit(limit),offset(offset));}

  @PatchMapping("/tasks/{id}") Map<String,Object> updateTask(@AuthenticationPrincipal CurrentUser u,@PathVariable String id,@RequestBody JsonNode b){var o=wh(u);
    if(b==null||!b.isObject()||b.size()==0)throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Provide at least one field to update");
    String status=text(b,"status");if(status!=null&&!TSTAT.contains(status))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid status");
    String priority=text(b,"priority");if(priority!=null&&!PRIOR.contains(priority))throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid priority");
    boolean hasAssigned=b.has("assignedTo");String assigned=hasAssigned?(b.get("assignedTo").isNull()?null:text(b,"assignedTo")):null;
    if(hasAssigned&&assigned!=null&&assigned.length()>80)throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid assignedTo");
    boolean hasBlocked=b.has("blockedReason");String blocked=hasBlocked?(b.get("blockedReason").isNull()?null:text(b,"blockedReason")):null;
    if(hasBlocked&&blocked!=null&&blocked.length()>500)throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Invalid blockedReason");
    return Map.of("task",svc.updateTask(o.id(),o.role(),o.warehouseId(),id,status,assigned,hasAssigned,priority,blocked,hasBlocked));}
  static String text(JsonNode b,String f){var n=b.get(f);if(n==null||n.isNull())return null;return n.asText();}

  @PostMapping("/tasks/{id}/claim") Map<String,Object> claim(@AuthenticationPrincipal CurrentUser u,@PathVariable String id){var o=wh(u);
    return Map.of("task",svc.updateTask(o.id(),o.role(),o.warehouseId(),id,"IN_PROGRESS",o.id(),true,null,null,false));}

  @GetMapping("/shipments") Map<String,Object> shipments(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String limit,@RequestParam(required=false) String offset){var o=wh(u);
    var out=new LinkedHashMap<String,Object>(svc.listShipments(limit(limit),offset(offset)));out.put("recentReceiving",svc.recentReceiving(o.warehouseId(),10));return out;}

  @GetMapping("/analytics") Map<String,Object> analytics(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String windowDays){return svc.warehouseAnalytics(wh(u).warehouseId(),windowDays(windowDays));}

  @GetMapping("/audit") Map<String,Object> audit(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String entityType,@RequestParam(required=false) String entityId,@RequestParam(required=false) String actorId,@RequestParam(required=false) String limit,@RequestParam(required=false) String offset){var o=wh(u);
    return svc.listAudit(o.warehouseId(),opt(entityType,40),opt(entityId,80),opt(actorId,80),limit(limit),offset(offset));}
}
