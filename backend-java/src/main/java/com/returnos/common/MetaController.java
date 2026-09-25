package com.returnos.common;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
@RestController @RequestMapping("/api/v1/meta") class MetaController {
  private final JdbcTemplate jdbc; MetaController(JdbcTemplate jdbc){this.jdbc=jdbc;}
  @GetMapping("/reasons") Map<String,Object> reasons(){return Map.of("reasons",jdbc.query("select code,label,description,active::int as active,sort_order from return_reasons where active=true order by sort_order,label",(rs,n)->{var x=new LinkedHashMap<String,Object>();var m=rs.getMetaData();for(int i=1;i<=m.getColumnCount();i++)x.put(m.getColumnLabel(i),rs.getObject(i));return x;}));}
  int windowDays(){try{var v=jdbc.query("select value::text from settings where key='RETURN_WINDOW_DAYS'",(r,n)->r.getString(1));if(!v.isEmpty()){int n=Integer.parseInt(v.getFirst().replace("\"","").trim());if(n>=1&&n<=365)return n;}}catch(Exception e){}return 30;}
  @GetMapping("/constants") Map<String,Object> constants(){return Map.of("resolutionTypes",List.of("REFUND","REPLACEMENT","EXCHANGE","STORE_CREDIT"),"pickupKinds",List.of("PICKUP","DROP_OFF"),"returnWindowDays",windowDays(),"returnStatuses",List.of("REQUESTED","APPROVED","INSPECTION","RESOLVED","REJECTED","CANCELLED"));}
}
