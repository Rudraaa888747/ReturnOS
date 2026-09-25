package com.returnos.care;

import com.returnos.auth.CurrentUser;
import com.returnos.common.ApiException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/v1/feedback") public class FeedbackController {
  private final JdbcTemplate jdbc; FeedbackController(JdbcTemplate jdbc){this.jdbc=jdbc;}
  record Feedback(@NotBlank String returnId,@NotNull @Min(1) @Max(5) Integer rating,@Size(max=2000) String comment){}
  private void customer(CurrentUser u){if(u==null)throw new ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHORIZED","Authentication required");if(!"CUSTOMER".equals(u.role()))throw new ApiException(HttpStatus.FORBIDDEN,"FORBIDDEN","Customer access required");}
  @PostMapping @ResponseStatus(HttpStatus.CREATED) @Transactional Map<String,Object> create(@AuthenticationPrincipal CurrentUser u,@Valid @RequestBody Feedback b){customer(u);
    if(jdbc.queryForObject("select count(*) from returns where id=? and customer_id=?",Integer.class,b.returnId(),u.id())==0)throw new ApiException(HttpStatus.NOT_FOUND,"RETURN_NOT_FOUND","Return not found");
    if(jdbc.queryForObject("select count(*) from feedback where return_id=?",Integer.class,b.returnId())>0)throw new ApiException(HttpStatus.CONFLICT,"FEEDBACK_EXISTS","Feedback was already submitted for this return");
    String id=UUID.randomUUID().toString();
    jdbc.update("insert into feedback(id,return_id,user_id,rating,comment) values(?,?,?,?,?)",id,b.returnId(),u.id(),b.rating(),b.comment());
    var rows=jdbc.query("select * from feedback where id=?",(r,n)->SupportController.map(r),id);
    return Map.of("feedback",rows.getFirst());}
  @GetMapping("/return/{returnId}") Map<String,Object> byReturn(@AuthenticationPrincipal CurrentUser u,@PathVariable String returnId){customer(u);
    if(jdbc.queryForObject("select count(*) from returns where id=? and customer_id=?",Integer.class,returnId,u.id())==0)throw new ApiException(HttpStatus.NOT_FOUND,"FEEDBACK_NOT_FOUND","Feedback not found");
    var rows=jdbc.query("select * from feedback where return_id=?",(r,n)->SupportController.map(r),returnId);
    if(rows.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"FEEDBACK_NOT_FOUND","Feedback not found");
    return Map.of("feedback",rows.getFirst());}
}
