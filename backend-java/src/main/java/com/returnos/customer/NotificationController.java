package com.returnos.customer;

import com.returnos.auth.CurrentUser;
import com.returnos.common.ApiException;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/v1/notifications") public class NotificationController {
  private final JdbcTemplate jdbc; NotificationController(JdbcTemplate jdbc){this.jdbc=jdbc;}
  private void customer(CurrentUser u){if(u==null)throw new ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHORIZED","Authentication required");if(!"CUSTOMER".equals(u.role()))throw new ApiException(HttpStatus.FORBIDDEN,"FORBIDDEN","Customer access required");}
  @GetMapping Map<String,Object> list(@AuthenticationPrincipal CurrentUser u,@RequestParam(required=false) String unreadOnly){customer(u);boolean unread="true".equalsIgnoreCase(unreadOnly)||"1".equals(unreadOnly);var sql="select id,user_id,return_id,type,title,body,is_read::int as is_read,created_at from notifications where user_id=?"+(unread?" and is_read=false":"")+" order by created_at desc";return Map.of("notifications",jdbc.query(sql,(rs,n)->map(rs),u.id()));}
  @PostMapping("/{id}/read") @Transactional Map<String,String> read(@AuthenticationPrincipal CurrentUser u,@PathVariable String id){customer(u);if(jdbc.update("update notifications set is_read=true where id=? and user_id=?",id,u.id())==0)throw new ApiException(HttpStatus.NOT_FOUND,"NOTIFICATION_NOT_FOUND","Notification not found");return Map.of("message","Notification marked as read");}
  @PostMapping("/read-all") @Transactional Map<String,Object> all(@AuthenticationPrincipal CurrentUser u){customer(u);var updated=jdbc.update("update notifications set is_read=true where user_id=? and is_read=false",u.id());return Map.of("message","All notifications marked as read","updated",updated);}
  private static Map<String,Object> map(java.sql.ResultSet r)throws java.sql.SQLException{var x=new LinkedHashMap<String,Object>();var m=r.getMetaData();for(int i=1;i<=m.getColumnCount();i++)x.put(m.getColumnLabel(i),r.getObject(i));return x;}
}
