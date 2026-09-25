package com.returnos.orders;

import com.returnos.auth.CurrentUser;
import com.returnos.common.ApiException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.Map;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/v1") public class OrderController {
  private final OrderService service; OrderController(OrderService service){this.service=service;}
  record Quote(@NotBlank String addressId,boolean useStoreCredit){} record Checkout(@NotBlank String addressId,boolean useStoreCredit,@NotBlank String idempotencyKey){}
  private void customer(CurrentUser u){if(u==null)throw new ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHORIZED","Authentication required");if(!"CUSTOMER".equals(u.role()))throw new ApiException(HttpStatus.FORBIDDEN,"FORBIDDEN","Customer access required");}
  @PostMapping("/checkout/quote") Map<String,Object> quote(@AuthenticationPrincipal CurrentUser u,@Valid @RequestBody Quote b){customer(u);return service.quote(u.id(),b.addressId(),b.useStoreCredit());}
  @PostMapping("/checkout") ResponseEntity<Map<String,Object>> checkout(@AuthenticationPrincipal CurrentUser u,@Valid @RequestBody Checkout b){customer(u);var key=b.idempotencyKey().trim();var replay=service.isReplay(u.id(),key);var result=service.checkout(u.id(),b.addressId(),b.useStoreCredit(),key);return ResponseEntity.status(replay?HttpStatus.OK:HttpStatus.CREATED).body(result);}
  @GetMapping("/orders") Map<String,Object> orders(@AuthenticationPrincipal CurrentUser u){customer(u);return Map.of("orders",service.list(u.id()));}
  @GetMapping("/orders/{id}") Map<String,Object> detail(@AuthenticationPrincipal CurrentUser u,@PathVariable String id){customer(u);return service.detail(u.id(),id);}
  @GetMapping("/orders/{id}/tracking") Map<String,Object> tracking(@AuthenticationPrincipal CurrentUser u,@PathVariable String id){customer(u);return service.tracking(u.id(),id);}
}
