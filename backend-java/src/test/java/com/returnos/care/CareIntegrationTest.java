package com.returnos.care;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.returnos.ReturnOsApplication;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.containers.PostgreSQLContainer;

@SpringBootTest(classes = ReturnOsApplication.class)
@AutoConfigureMockMvc
class CareIntegrationTest {
  static final PostgreSQLContainer<?> postgres;
  static final Path uploads;
  static {
    String externalUrl = System.getenv("TEST_DB_URL");
    if (externalUrl == null || externalUrl.isBlank()) {
      postgres = new PostgreSQLContainer<>("postgres:16-alpine");
      postgres.start();
    } else {
      postgres = null;
    }
    try { uploads = Files.createTempDirectory("returnos-uploads-test"); }
    catch (Exception e) { throw new RuntimeException(e); }
  }
  @DynamicPropertySource static void database(DynamicPropertyRegistry r) {
    String externalUrl = System.getenv("TEST_DB_URL");
    if (externalUrl != null && !externalUrl.isBlank()) {
      r.add("spring.datasource.url", () -> externalUrl);
      r.add("spring.datasource.username", () -> envOr("TEST_DB_USERNAME", "postgres"));
      r.add("spring.datasource.password", () -> System.getenv("TEST_DB_PASSWORD"));
    } else {
      r.add("spring.datasource.url", postgres::getJdbcUrl); r.add("spring.datasource.username", postgres::getUsername); r.add("spring.datasource.password", postgres::getPassword);
    }
    r.add("returnos.jwt-secret", () -> "test-secret-with-at-least-thirty-two-characters");
    r.add("returnos.fulfillment-enabled", () -> "false");
    r.add("returnos.upload-dir", () -> uploads.toString());
  }
  static String envOr(String name, String fallback) {
    String v = System.getenv(name);
    return (v == null || v.isBlank()) ? fallback : v;
  }
  @Autowired MockMvc http; @Autowired ObjectMapper json; @Autowired JdbcTemplate jdbc;
  String token, customer, address, orderId, orderItemId, retId;
  @BeforeEach void seed() throws Exception {
    jdbc.execute("TRUNCATE users CASCADE");
    jdbc.update("delete from inventory_buckets where product_id='p-care'");
    jdbc.update("delete from products where id='p-care'");
    var signup = callAs(null,post("/api/v1/auth/signup"), "{\"email\":\"care@example.test\",\"password\":\"Password123\",\"fullName\":\"Care\"}", 201);
    token=signup.path("token").asText(); customer=signup.path("user").path("id").asText();
    jdbc.update("insert into products(id,sku,name,price_paise,stock,active) values('p-care','CARE-1','Care Item',20000,10,true)");
    jdbc.update("insert into inventory_buckets(warehouse_id,product_id,state,quantity) values('wh-blr-01','p-care','AVAILABLE',10)");
    var a=callAs(token,post("/api/v1/addresses"), "{\"fullName\":\"Care\",\"line1\":\"1 Lane\",\"city\":\"Bengaluru\",\"state\":\"Karnataka\",\"postalCode\":\"560001\"}",201); address=a.path("address").path("id").asText();
    callAs(token,post("/api/v1/cart"), "{\"productId\":\"p-care\",\"quantity\":1}",201);
    orderId=callAs(token,post("/api/v1/checkout"), "{\"addressId\":\""+address+"\",\"idempotencyKey\":\"care-"+UUID.randomUUID()+"\"}",201).path("order").path("id").asText();
    jdbc.update("update orders set delivered_at=now() where id=?",orderId);
    orderItemId=jdbc.queryForObject("select id from order_items where order_id=? limit 1",String.class,orderId);
    retId=callAs(token,post("/api/v1/returns"), "{\"orderId\":\""+orderId+"\",\"items\":[{\"orderItemId\":\""+orderItemId+"\",\"quantity\":1,\"reasonCode\":\"OTHER\"}],\"resolutionType\":\"REFUND\",\"pickupKind\":\"PICKUP\"}",201).path("ret").path("id").asText();
  }
  @Test void supportTickets() throws Exception {
    var created=callAs(token,post("/api/v1/support/tickets"), "{\"subject\":\"Where is my pickup?\",\"body\":\"Agent never arrived\"}",201);
    String ticket=created.path("ticket").path("id").asText();
    assertThat(created.path("ticket").path("ticket_number").asText()).startsWith("TCK-");
    assertThat(created.path("ticket").path("status").asText()).isEqualTo("OPEN");
    assertThat(created.path("message").path("author_role").asText()).isEqualTo("CUSTOMER");
    var withRet=callAs(token,post("/api/v1/support/tickets"), "{\"subject\":\"Item query here\",\"body\":\"Question\",\"returnId\":\""+retId+"\"}",201);
    assertThat(withRet.path("ticket").path("return_id").asText()).isEqualTo(retId);
    assertThat(callAs(token,post("/api/v1/support/tickets"), "{\"subject\":\"Item query here\",\"body\":\"Q\",\"returnId\":\"missing\"}",404).path("code").asText()).isEqualTo("RETURN_NOT_FOUND");
    assertThat(callAs(token,post("/api/v1/support/tickets"), "{\"subject\":\"Hey\",\"body\":\"Q\"}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    assertThat(callAs(token,post("/api/v1/support/tickets"), "{\"subject\":\"Valid subject\",\"body\":\"\"}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    assertThat(callAs(token,get("/api/v1/support/tickets"),null,200).path("tickets").size()).isEqualTo(2);
    var detail=callAs(token,get("/api/v1/support/tickets/"+ticket),null,200);
    assertThat(detail.path("messages").size()).isEqualTo(1);
    assertThat(callAs(token,get("/api/v1/support/tickets/missing"),null,404).path("code").asText()).isEqualTo("TICKET_NOT_FOUND");
    var msg=callAs(token,post("/api/v1/support/tickets/"+ticket+"/messages"), "{\"body\":\"Any update?\"}",201);
    assertThat(msg.path("message").path("body").asText()).isEqualTo("Any update?");
    assertThat(callAs(token,post("/api/v1/support/tickets/missing/messages"), "{\"body\":\"x\"}",404).path("code").asText()).isEqualTo("TICKET_NOT_FOUND");
    var closed=callAs(token,post("/api/v1/support/tickets/"+ticket+"/close"),null,200);
    assertThat(closed.path("ticket").path("status").asText()).isEqualTo("CLOSED");
    assertThat(callAs(token,post("/api/v1/support/tickets/"+ticket+"/messages"), "{\"body\":\"late\"}",409).path("code").asText()).isEqualTo("TICKET_CLOSED");
    assertThat(callAs(token,post("/api/v1/support/tickets/missing/close"),null,404).path("code").asText()).isEqualTo("TICKET_NOT_FOUND");
    var other=callAs(null,post("/api/v1/auth/signup"), "{\"email\":\"intruder@example.test\",\"password\":\"Password123\",\"fullName\":\"Intruder\"}",201);
    assertThat(callAs(other.path("token").asText(),get("/api/v1/support/tickets/"+ticket),null,404).path("code").asText()).isEqualTo("TICKET_NOT_FOUND");
    assertThat(anon(get("/api/v1/support/tickets"),401).path("code").asText()).isEqualTo("UNAUTHORIZED");
  }
  @Test void feedback() throws Exception {
    assertThat(callAs(token,get("/api/v1/feedback/return/"+retId),null,404).path("code").asText()).isEqualTo("FEEDBACK_NOT_FOUND");
    var created=callAs(token,post("/api/v1/feedback"), "{\"returnId\":\""+retId+"\",\"rating\":5,\"comment\":\"Great\"}",201);
    assertThat(created.path("feedback").path("rating").asInt()).isEqualTo(5);
    assertThat(callAs(token,post("/api/v1/feedback"), "{\"returnId\":\""+retId+"\",\"rating\":4}",409).path("code").asText()).isEqualTo("FEEDBACK_EXISTS");
    assertThat(callAs(token,post("/api/v1/feedback"), "{\"returnId\":\"missing\",\"rating\":4}",404).path("code").asText()).isEqualTo("RETURN_NOT_FOUND");
    assertThat(callAs(token,post("/api/v1/feedback"), "{\"returnId\":\""+retId+"\",\"rating\":0}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    assertThat(callAs(token,post("/api/v1/feedback"), "{\"returnId\":\""+retId+"\",\"rating\":6}",400).path("code").asText()).isEqualTo("VALIDATION_ERROR");
    assertThat(callAs(token,get("/api/v1/feedback/return/"+retId),null,200).path("feedback").path("rating").asInt()).isEqualTo(5);
    var other=callAs(null,post("/api/v1/auth/signup"), "{\"email\":\"intruder2@example.test\",\"password\":\"Password123\",\"fullName\":\"Intruder\"}",201);
    assertThat(callAs(other.path("token").asText(),get("/api/v1/feedback/return/"+retId),null,404).path("code").asText()).isEqualTo("FEEDBACK_NOT_FOUND");
  }
  @Test void documentsAndUploads() throws Exception {
    assertThat(callAs(token,get("/api/v1/documents/return/"+retId),null,200).path("documents").size()).isZero();
    assertThat(callAs(token,get("/api/v1/documents/return/missing"),null,404).path("code").asText()).isEqualTo("RETURN_NOT_FOUND");
    byte[] pdf="%PDF-1.4 test".getBytes();
    var uploaded=upload(token,retId,new MockMultipartFile("file","invoice.pdf","application/pdf",pdf),"my photos!");
    assertThat(uploaded.path("document").path("kind").asText()).isEqualTo("MY_PHOTOS_");
    assertThat(uploaded.path("document").path("mime").asText()).isEqualTo("application/pdf");
    assertThat(uploaded.path("document").path("size").asInt()).isEqualTo(pdf.length);
    assertThat(jdbc.queryForObject("select count(*) from notifications where user_id=? and type='DOCUMENT_UPLOADED'",Integer.class,customer)).isEqualTo(1);
    var bad=multipart("/api/v1/uploads/return/"+retId).file(new MockMultipartFile("file","evil.txt","text/plain","x".getBytes()));
    assertThat(callAs(token,bad,null,400).path("code").asText()).isEqualTo("INVALID_FILE_TYPE");
    var nofile=multipart("/api/v1/uploads/return/"+retId).param("kind","EVIDENCE");
    assertThat(callAs(token,nofile,null,400).path("code").asText()).isEqualTo("FILE_REQUIRED");
    var foreign=multipart("/api/v1/uploads/return/missing").file(new MockMultipartFile("file","a.pdf","application/pdf",pdf));
    assertThat(callAs(token,foreign,null,404).path("code").asText()).isEqualTo("RETURN_NOT_FOUND");
    String docId=uploaded.path("document").path("id").asText();
    assertThat(callAs(token,get("/api/v1/documents/return/"+retId),null,200).path("documents").size()).isEqualTo(1);
    var dl=http.perform(multipartGet(docId,token)).andExpect(status().is(200)).andReturn();
    assertThat(dl.getResponse().getContentAsByteArray()).isEqualTo(pdf);
    assertThat(dl.getResponse().getContentType()).contains("application/pdf");
    assertThat(callAs(token,get("/api/v1/documents/missing/download"),null,404).path("code").asText()).isEqualTo("DOCUMENT_NOT_FOUND");
    Files.delete(Path.of(uploaded.path("document").path("storage_path").asText()));
    assertThat(callAs(token,get("/api/v1/documents/"+docId+"/download"),null,404).path("code").asText()).isEqualTo("FILE_MISSING");
    var other=callAs(null,post("/api/v1/auth/signup"), "{\"email\":\"intruder3@example.test\",\"password\":\"Password123\",\"fullName\":\"Intruder\"}",201);
    assertThat(callAs(other.path("token").asText(),get("/api/v1/documents/"+docId+"/download"),null,404).path("code").asText()).isEqualTo("DOCUMENT_NOT_FOUND");
  }
  JsonNode upload(String tok,String returnId,MockMultipartFile file,String kind) throws Exception {
    var req=multipart("/api/v1/uploads/return/"+returnId).file(file);
    if(kind!=null)req.param("kind",kind);
    req.header("Authorization","Bearer "+tok);
    var result=http.perform(req).andExpect(status().is(201)).andReturn();
    return json.readTree(result.getResponse().getContentAsString());
  }
  org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder multipartGet(String docId,String tok){return get("/api/v1/documents/"+docId+"/download").header("Authorization","Bearer "+tok);}
  private JsonNode callAs(String tok,MockHttpServletRequestBuilder b,String body,int expected) throws Exception { if(body!=null){b.content(body);b.contentType(MediaType.APPLICATION_JSON);} if(tok!=null)b.header("Authorization","Bearer "+tok); var result=http.perform(b).andExpect(status().is(expected)).andReturn(); return json.readTree(result.getResponse().getContentAsString()); }
  private JsonNode anon(MockHttpServletRequestBuilder b,int expected) throws Exception { var result=http.perform(b.contentType(MediaType.APPLICATION_JSON)).andExpect(status().is(expected)).andReturn(); return json.readTree(result.getResponse().getContentAsString()); }
}
