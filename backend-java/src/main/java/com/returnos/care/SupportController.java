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

@RestController @RequestMapping("/api/v1/support") public class SupportController {
  private final JdbcTemplate jdbc; SupportController(JdbcTemplate jdbc){this.jdbc=jdbc;}
  record Ticket(@NotNull @Size(min=4,max=200) String subject,@NotNull @Size(min=1,max=4000) String body,String returnId){}
  record Message(@NotNull @Size(min=1,max=4000) String body){}
  private void customer(CurrentUser u){if(u==null)throw new ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHORIZED","Authentication required");if(!"CUSTOMER".equals(u.role()))throw new ApiException(HttpStatus.FORBIDDEN,"FORBIDDEN","Customer access required");}
  @PostMapping("/tickets") @ResponseStatus(HttpStatus.CREATED) @Transactional Map<String,Object> create(@AuthenticationPrincipal CurrentUser u,@Valid @RequestBody Ticket b){customer(u);
    if(b.returnId()!=null&&!b.returnId().isBlank()&&jdbc.queryForObject("select count(*) from returns where id=? and customer_id=?",Integer.class,b.returnId(),u.id())==0)throw new ApiException(HttpStatus.NOT_FOUND,"RETURN_NOT_FOUND","Return not found");
    if(b.returnId()!=null&&b.returnId().isBlank())throw new ApiException(HttpStatus.BAD_REQUEST,"VALIDATION_ERROR","Request validation failed");
    var t=OffsetDateTime.now(ZoneOffset.UTC);String id=UUID.randomUUID().toString();String number=nextTicketNumber();
    jdbc.update("insert into support_tickets(id,ticket_number,user_id,return_id,subject,status,created_at,updated_at) values(?,?,?,?,?,'OPEN',?,?)",id,number,u.id(),blankToNull(b.returnId()),b.subject(),t,t);
    String mid=UUID.randomUUID().toString();
    jdbc.update("insert into support_messages(id,ticket_id,author_role,body,created_at) values(?,?,'CUSTOMER',?,?)",mid,id,b.body(),t);
    var out=new LinkedHashMap<String,Object>();out.put("ticket",one("select * from support_tickets where id=?",id));out.put("message",one("select * from support_messages where id=?",mid));return out;}
  @GetMapping("/tickets") Map<String,Object> list(@AuthenticationPrincipal CurrentUser u){customer(u);return Map.of("tickets",jdbc.query("select * from support_tickets where user_id=? order by created_at desc",(r,n)->map(r),u.id()));}
  @GetMapping("/tickets/{id}") Map<String,Object> detail(@AuthenticationPrincipal CurrentUser u,@PathVariable String id){customer(u);return ticketDetail(u.id(),id);}
  @PostMapping("/tickets/{id}/messages") @ResponseStatus(HttpStatus.CREATED) @Transactional Map<String,Object> message(@AuthenticationPrincipal CurrentUser u,@PathVariable String id,@Valid @RequestBody Message b){customer(u);
    var t0=jdbc.query("select status from support_tickets where id=? and user_id=?",(r,n)->r.getString(1),id,u.id());
    if(t0.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"TICKET_NOT_FOUND","Support ticket not found");
    if("CLOSED".equals(t0.getFirst()))throw new ApiException(HttpStatus.CONFLICT,"TICKET_CLOSED","Closed tickets cannot receive new messages");
    var t=OffsetDateTime.now(ZoneOffset.UTC);String mid=UUID.randomUUID().toString();
    jdbc.update("insert into support_messages(id,ticket_id,author_role,body,created_at) values(?,?,'CUSTOMER',?,?)",mid,id,b.body(),t);
    jdbc.update("update support_tickets set updated_at=? where id=?",t,id);
    return Map.of("message",one("select * from support_messages where id=?",mid));}
  @PostMapping("/tickets/{id}/close") @Transactional Map<String,Object> close(@AuthenticationPrincipal CurrentUser u,@PathVariable String id){customer(u);
    var t0=jdbc.query("select * from support_tickets where id=? and user_id=?",(r,n)->map(r),id,u.id());
    if(t0.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"TICKET_NOT_FOUND","Support ticket not found");
    var t=OffsetDateTime.now(ZoneOffset.UTC);
    jdbc.update("update support_tickets set status='CLOSED',updated_at=? where id=?",t,id);
    return Map.of("ticket",one("select * from support_tickets where id=?",id));}
  private Map<String,Object> ticketDetail(String uid,String id){var t0=jdbc.query("select * from support_tickets where id=? and user_id=?",(r,n)->map(r),id,uid);if(t0.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"TICKET_NOT_FOUND","Support ticket not found");var out=new LinkedHashMap<String,Object>();out.put("ticket",t0.getFirst());out.put("messages",jdbc.query("select * from support_messages where ticket_id=? order by created_at asc",(r,n)->map(r),id));return out;}
  private String nextTicketNumber(){var year=String.valueOf(Year.now(ZoneOffset.UTC).getValue());jdbc.update("insert into ticket_counter(year,last_seq) values(?,0) on conflict do nothing",year);int seq=jdbc.queryForObject("update ticket_counter set last_seq=last_seq+1 where year=? returning last_seq",Integer.class,year);return "TCK-"+year+"-"+String.format("%04d",seq);}
  static String blankToNull(String s){return s==null||s.isBlank()?null:s;}
  Map<String,Object> one(String sql,String arg){var x=jdbc.query(sql,(r,n)->map(r),arg);return x.isEmpty()?null:x.getFirst();}
  static Map<String,Object> map(java.sql.ResultSet r)throws java.sql.SQLException{var x=new LinkedHashMap<String,Object>();var m=r.getMetaData();for(int i=1;i<=m.getColumnCount();i++)x.put(m.getColumnLabel(i),r.getObject(i));return x;}
}
