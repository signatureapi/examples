package com.example.webhook;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

class WebhookControllerTest {
  private static final JsonNode VECTOR = load();

  private MockMvc mvc;

  private static JsonNode load() {
    try {
      return new ObjectMapper().readTree(Files.readString(Path.of("../../verify-webhooks/test-vector.json")));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  @BeforeEach
  void setUp() {
    // A clock frozen at the vector's "now" makes the 5 minute tolerance deterministic.
    Clock clock = Clock.fixed(Instant.ofEpochSecond(VECTOR.get("now").asLong()), ZoneOffset.UTC);
    mvc = MockMvcBuilders.standaloneSetup(new WebhookController(VECTOR.get("secret").asText(), clock)).build();
  }

  private MockHttpServletRequestBuilder delivery(String name) {
    for (JsonNode c : VECTOR.get("cases")) {
      if (c.get("name").asText().equals(name)) {
        // content(byte[]) sends the body string byte for byte.
        MockHttpServletRequestBuilder req =
            post("/webhooks/signatureapi")
                .contentType(MediaType.APPLICATION_JSON)
                .content(c.get("body").asText().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        c.get("headers").properties().forEach(e -> req.header(e.getKey(), e.getValue().asText()));
        return req;
      }
    }
    throw new IllegalArgumentException(name);
  }

  @Test
  void validDeliveryReturns2xx() throws Exception {
    mvc.perform(delivery("valid")).andExpect(status().isOk());
  }

  @Test
  void repeatedWebhookIdIsADuplicate() throws Exception {
    mvc.perform(delivery("valid")).andExpect(status().isOk());
    mvc.perform(delivery("valid")).andExpect(status().isOk()).andExpect(content().json("{\"status\":\"duplicate\"}"));
  }

  @Test
  void tamperedBodyReturns4xx() throws Exception {
    mvc.perform(delivery("tampered_body")).andExpect(status().isBadRequest());
  }

  @Test
  void wrongSecretReturns4xx() throws Exception {
    mvc.perform(delivery("wrong_secret_signature")).andExpect(status().isBadRequest());
  }

  @Test
  void missingHeadersReturn4xx() throws Exception {
    mvc.perform(delivery("missing_headers")).andExpect(status().isBadRequest());
  }
}
