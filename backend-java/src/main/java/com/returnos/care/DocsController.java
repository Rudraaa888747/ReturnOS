package com.returnos.care;

import com.returnos.auth.CurrentUser;
import com.returnos.common.ApiException;
import com.returnos.storage.StorageService;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController @RequestMapping("/api/v1") public class DocsController {
  static final Map<String,String> ALLOWED_MIME=Map.of("image/jpeg",".jpg","image/png",".png","image/webp",".webp","application/pdf",".pdf");
  private final JdbcTemplate jdbc; private final StorageService storage;
  DocsController(JdbcTemplate jdbc,StorageService storage) {this.jdbc=jdbc;this.storage=storage;}
  private void customer(CurrentUser u){if(u==null)throw new ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHORIZED","Authentication required");if(!"CUSTOMER".equals(u.role()))throw new ApiException(HttpStatus.FORBIDDEN,"FORBIDDEN","Customer access required");}
  static String sanitizeKind(Object raw){if(raw instanceof String s&&!s.isBlank()&&s.length()<=40)return s.trim().toUpperCase().replaceAll("[^A-Z0-9_]","_");return "EVIDENCE";}

  @GetMapping("/documents/return/{returnId}") Map<String,Object> byReturn(@AuthenticationPrincipal CurrentUser u,@PathVariable String returnId){customer(u);
    if(jdbc.queryForObject("select count(*) from returns where id=? and customer_id=?",Integer.class,returnId,u.id())==0)throw new ApiException(HttpStatus.NOT_FOUND,"RETURN_NOT_FOUND","Return not found");
    return Map.of("documents",jdbc.query("select * from documents where return_id=? order by created_at desc",(r,n)->SupportController.map(r),returnId));}

  @GetMapping("/documents/{id}/download") ResponseEntity<?> download(@AuthenticationPrincipal CurrentUser u,@PathVariable String id) {customer(u);
    var rows=jdbc.query("select * from documents where id=? and user_id=?",(r,n)->SupportController.map(r),id,u.id());
    if(rows.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"DOCUMENT_NOT_FOUND","Document not found");
    var doc=rows.getFirst();String key=(String)doc.get("storage_path");
    // Ownership is verified above; providers that mint direct URLs (S3)
    // answer with a short-lived redirect, others stream through the backend.
    var direct=storage.presignedDownload(key,(String)doc.get("filename"),(String)doc.get("mime"));
    if(direct.isPresent())return ResponseEntity.status(HttpStatus.FOUND).location(direct.get()).build();
    return ResponseEntity.ok().contentType(MediaType.parseMediaType((String)doc.get("mime"))).body(storage.load(key));}

  @PostMapping("/uploads/return/{returnId}") @ResponseStatus(HttpStatus.CREATED) @Transactional Map<String,Object> upload(@AuthenticationPrincipal CurrentUser u,@PathVariable String returnId,@RequestParam(value="file",required=false) MultipartFile file,@RequestParam(value="kind",required=false) String kind) throws java.io.IOException {customer(u);
    var rets=jdbc.query("select * from returns where id=? and customer_id=?",(r,n)->SupportController.map(r),returnId,u.id());
    if(rets.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"RETURN_NOT_FOUND","Return not found");
    if(file==null)throw new ApiException(HttpStatus.BAD_REQUEST,"FILE_REQUIRED","A file upload named \"file\" is required");
    String mime=file.getContentType()==null?"":file.getContentType().split(";")[0].trim().toLowerCase();
    if(!ALLOWED_MIME.containsKey(mime))throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_FILE_TYPE","Only JPG, PNG, WEBP, and PDF files are accepted");
    var ret=rets.getFirst();String id=UUID.randomUUID().toString();
    String key=StorageService.keyFor((String)ret.get("id"),ALLOWED_MIME.get(mime));
    storage.store(key,file.getBytes(),mime);
    String k=sanitizeKind(kind);String original=file.getOriginalFilename()==null?"file":file.getOriginalFilename();
    var t=OffsetDateTime.now(ZoneOffset.UTC);
    jdbc.update("insert into documents(id,return_id,user_id,kind,filename,mime,size,storage_path,created_at) values(?,?,?,?,?,?,?,?,?)",id,ret.get("id"),u.id(),k,original,mime,file.getSize(),key,t);
    jdbc.update("insert into return_events(id,return_id,status,description) values(?,?,?,?)",UUID.randomUUID().toString(),ret.get("id"),ret.get("status"),"Document uploaded: "+original);
    jdbc.update("insert into notifications(id,user_id,return_id,type,title,body) values(?,?,?, 'DOCUMENT_UPLOADED','Document uploaded',?||' was attached to return '||?||'.')",UUID.randomUUID().toString(),u.id(),ret.get("id"),original,ret.get("return_number"));
    return Map.of("document",jdbc.query("select * from documents where id=?",(r,n)->SupportController.map(r),id).getFirst());}
}
