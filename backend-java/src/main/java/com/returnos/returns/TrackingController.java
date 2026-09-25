package com.returnos.returns;

import com.returnos.auth.CurrentUser;
import com.returnos.common.ApiException;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/v1/tracking") public class TrackingController {
  private final JdbcTemplate jdbc; TrackingController(JdbcTemplate jdbc){this.jdbc=jdbc;}
  private void customer(CurrentUser u){if(u==null)throw new ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHORIZED","Authentication required");if(!"CUSTOMER".equals(u.role()))throw new ApiException(HttpStatus.FORBIDDEN,"FORBIDDEN","Customer access required");}
  @GetMapping("/{returnNumber}") Map<String,Object> track(@AuthenticationPrincipal CurrentUser u,@PathVariable String returnNumber){
    customer(u);
    var rows=jdbc.query("select * from returns where return_number=?",(r,n)->map(r),returnNumber);
    if(rows.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"TRACKING_NOT_FOUND","Return not found");
    var ret=rows.getFirst();
    if(!u.id().equals(ret.get("customer_id")))throw new ApiException(HttpStatus.NOT_FOUND,"TRACKING_NOT_FOUND","Return not found");
    String id=(String)ret.get("id");
    var out=new LinkedHashMap<String,Object>();
    out.put("returnNumber",ret.get("return_number"));out.put("status",ret.get("status"));out.put("resolutionType",ret.get("resolution_type"));out.put("updatedAt",ret.get("updated_at"));
    out.put("events",jdbc.query("select * from return_events where return_id=? order by created_at asc",(r,n)->map(r),id));
    out.put("pickup",one("select * from pickups where return_id=?",id));out.put("refund",one("select * from refunds where return_id=?",id));
    return out;
  }
  private Map<String,Object> one(String sql,String arg){var x=jdbc.query(sql,(r,n)->map(r),arg);return x.isEmpty()?null:x.getFirst();}
  private static Map<String,Object> map(java.sql.ResultSet r)throws java.sql.SQLException{var x=new LinkedHashMap<String,Object>();var m=r.getMetaData();for(int i=1;i<=m.getColumnCount();i++)x.put(m.getColumnLabel(i),r.getObject(i));return x;}
}
