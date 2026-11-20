package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"
)

const (
	envelopeID    = "eb4cf433-a8af-4161-b37b-7ef57d423e56"
	deliverableID = "del_5hN8sD2jKq7WxZ4mPv9Ta3"
	newEnvelopeID = "688d2c9f-5dbe-4bc4-bd0b-2e0459016be8"
)

var fakeKey = strings.Join([]string{"key", "test", "offline"}, "_")

type vectorCase struct {
	Name    string            `json:"name"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
	Expect  string            `json:"expect"`
}

type vector struct {
	Secret    string       `json:"secret"`
	Now       int64        `json:"now"`
	Tolerance int64        `json:"tolerance_seconds"`
	Cases     []vectorCase `json:"cases"`
}

func loadVector(t *testing.T) vector {
	t.Helper()
	data, err := os.ReadFile("../../verify-webhooks/test-vector.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vector
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestVector(t *testing.T) {
	v := loadVector(t)
	for _, c := range v.Cases {
		t.Run(c.Name, func(t *testing.T) {
			header := http.Header{}
			for name, value := range c.Headers {
				header.Set(name, value)
			}
			err := verifyWebhook(v.Secret, header, []byte(c.Body), time.Unix(v.Now, 0), 300*time.Second)
			if c.Expect == "valid" && err != nil {
				t.Fatalf("expected valid, got %v", err)
			}
			if c.Expect != "valid" && !errors.Is(err, errWebhook) {
				t.Fatalf("expected a verification error, got %v", err)
			}
		})
	}
}

// mockAPI stands in for SignatureAPI and records the last envelope body it received.
func mockAPI(t *testing.T) (*httptest.Server, *map[string]any) {
	t.Helper()
	var last map[string]any
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reply := func(status int, v any) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			json.NewEncoder(w).Encode(v)
		}
		if r.URL.Path == "/files/signed.pdf" { // the deliverable URL is pre-signed: no API key
			w.Header().Set("Content-Type", "application/pdf")
			io.WriteString(w, "%PDF-1.7 mock")
			return
		}
		if r.Header.Get("X-API-Key") != fakeKey {
			reply(401, map[string]string{"title": "Unauthorized"})
			return
		}
		switch {
		case r.Method == "POST" && r.URL.Path == "/v1/envelopes":
			json.NewDecoder(r.Body).Decode(&last)
			reply(201, map[string]any{"id": newEnvelopeID, "status": "processing", "recipients": []any{map[string]any{"ceremony": map[string]any{"url": nil}}}})
		case r.Method == "GET" && r.URL.Path == "/v1/envelopes/"+newEnvelopeID: // finished processing
			reply(200, map[string]any{"id": newEnvelopeID, "status": "in_progress",
				"recipients": []any{map[string]any{"ceremony": map[string]any{"url": "https://sign.signatureapi.com/en/start?token=mock"}}}})
		case r.URL.Path == "/v1/deliverables/"+deliverableID:
			reply(200, map[string]any{"id": deliverableID, "status": "generated", "url": srv.URL + "/files/signed.pdf"})
		default:
			reply(200, map[string]any{"id": envelopeID, "status": "completed", "deliverable": map[string]any{"id": deliverableID}})
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &last
}

func newTestApp(t *testing.T) (http.Handler, *map[string]any) {
	srv, last := mockAPI(t)
	v := loadVector(t)
	return newServer(Config{APIKey: fakeKey, BaseURL: srv.URL, WebhookSecret: v.Secret, AppOrigin: "https://app.acme.example"}), last
}

func do(app http.Handler, method, path, body string, header map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	for name, value := range header {
		req.Header.Set(name, value)
	}
	rec := httptest.NewRecorder()
	app.ServeHTTP(rec, req)
	return rec
}

func TestPageChecksOrigin(t *testing.T) {
	app, _ := newTestApp(t)
	rec := do(app, "GET", "/", "", nil)
	if !strings.Contains(rec.Body.String(), "event.origin !== CEREMONY_ORIGIN") {
		t.Fatal("the page must check event.origin")
	}
}

func TestCreateContract(t *testing.T) {
	app, last := newTestApp(t)
	rec := do(app, "POST", "/api/contracts", `{"name":"Jane Doe","email":"jane.doe@example.com"}`, nil)
	if rec.Code != 201 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var out map[string]string
	json.Unmarshal(rec.Body.Bytes(), &out)
	if out["envelopeId"] != newEnvelopeID {
		t.Fatalf("unexpected envelope id %q", out["envelopeId"])
	}
	recipient := (*last)["recipients"].([]any)[0].(map[string]any)
	if recipient["delivery_type"] != "none" {
		t.Fatal("delivery_type must be none")
	}
	if got := recipient["ceremony"].(map[string]any)["embeddable_in"]; !reflect.DeepEqual(got, []any{"https://app.acme.example"}) {
		t.Fatalf("unexpected embeddable_in %v", got)
	}
	auth := recipient["ceremony"].(map[string]any)["authentication"].([]any)[0].(map[string]any)
	if auth["type"] != "custom" || auth["provider"] != "Acme Corp Portal" {
		t.Fatalf("unexpected authentication %v", auth)
	}
}

func TestCreateRequiresFields(t *testing.T) {
	app, _ := newTestApp(t)
	if rec := do(app, "POST", "/api/contracts", `{}`, nil); rec.Code != 422 {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestWebhookFlow(t *testing.T) {
	app, _ := newTestApp(t)
	v := loadVector(t)
	var valid, tampered vectorCase
	for _, c := range v.Cases {
		switch c.Name {
		case "valid":
			valid = c
		case "tampered_body":
			tampered = c
		}
	}
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	key, _ := base64.StdEncoding.DecodeString(strings.TrimPrefix(v.Secret, "whsec_"))
	id := valid.Headers["webhook-id"]
	mac := hmac.New(sha256.New, key)
	fmt.Fprintf(mac, "%s.%s.%s", id, ts, valid.Body)
	header := map[string]string{"webhook-id": id, "webhook-timestamp": ts,
		"webhook-signature": "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil))}

	if rec := do(app, "POST", "/webhooks/signatureapi", valid.Body, header); strings.TrimSpace(rec.Body.String()) != `{"received":true}` {
		t.Fatalf("first delivery: %d %s", rec.Code, rec.Body)
	}
	if rec := do(app, "POST", "/webhooks/signatureapi", valid.Body, header); strings.TrimSpace(rec.Body.String()) != `{"duplicate":true}` {
		t.Fatalf("duplicate delivery: %d %s", rec.Code, rec.Body)
	}
	header["webhook-id"] = "msg_other"
	if rec := do(app, "POST", "/webhooks/signatureapi", tampered.Body, header); rec.Code != 400 {
		t.Fatalf("tampered body: %d", rec.Code)
	}
	rec := do(app, "GET", "/api/contracts/"+envelopeID, "", nil)
	var status struct{ WebhookEvents []string }
	json.Unmarshal(rec.Body.Bytes(), &status)
	if !reflect.DeepEqual(status.WebhookEvents, []string{"envelope.completed"}) {
		t.Fatalf("unexpected events %v", status.WebhookEvents)
	}
}

func TestSignedPDF(t *testing.T) {
	app, _ := newTestApp(t)
	rec := do(app, "GET", "/api/contracts/"+envelopeID+"/signed.pdf", "", nil)
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/pdf" {
		t.Fatalf("status %d type %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	if !strings.Contains(rec.Header().Get("Content-Disposition"), "signed-service-agreement.pdf") {
		t.Fatal("missing attachment filename")
	}
	if !bytes.HasPrefix(rec.Body.Bytes(), []byte("%PDF")) {
		t.Fatal("body is not a PDF")
	}
}

func liveConfig(t *testing.T) Config {
	t.Helper()
	if os.Getenv("SIGNATUREAPI_KEY") == "" {
		t.Skip("live test: set SIGNATUREAPI_KEY to a test key")
	}
	cfg, err := configFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

func TestLiveCreateEmbeddedEnvelope(t *testing.T) {
	cfg := liveConfig(t)
	cfg.AppOrigin = "https://app.acme.example"
	id, ceremonyURL, err := cfg.createSigningSession("Jane Doe", "jane.doe@example.com", "usr_tutorial")
	if err != nil {
		t.Fatal(err)
	}
	if len(id) != 36 {
		t.Fatalf("unexpected envelope id %q", id)
	}
	// Never print the ceremony URL: it is a bearer link for the signer.
	if !strings.HasPrefix(ceremonyURL, "https://") {
		t.Fatal("ceremony url must be https")
	}
}

// An automatic signer completes the envelope without a person, so the download step runs for real.
func TestLiveDownloadSignedPDF(t *testing.T) {
	cfg := liveConfig(t)
	png, err := os.ReadFile("../../scripts/assets/acme-mark.png")
	if err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequest("POST", cfg.BaseURL+"/v1/uploads", bytes.NewReader(png))
	req.Header.Set("X-API-Key", cfg.APIKey)
	req.Header.Set("Content-Type", "image/png")
	resp, err := httpClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var upload struct{ URL string }
	json.NewDecoder(resp.Body).Decode(&upload)
	if resp.StatusCode != 201 || upload.URL == "" {
		t.Fatalf("upload failed with %d", resp.StatusCode)
	}
	body := buildContract("Jane Doe", "jane.doe@example.com", "usr_tutorial", "https://app.acme.example")
	body["recipients"] = []any{map[string]any{
		"key": "client", "type": "automatic_signer", "name": "Jane Doe",
		"signature": map[string]any{"type": "drawn", "url": upload.URL},
		"mandate":   "Authorized by Acme Corp board resolution 2026-04 (synthetic example)",
	}}
	var created Envelope
	if err := cfg.api("POST", "/v1/envelopes", body, &created); err != nil {
		t.Fatal(err)
	}
	for range 60 {
		time.Sleep(2 * time.Second)
		pdf, err := cfg.downloadSignedPDF(created.ID)
		var notReady errNotReady
		if errors.As(err, &notReady) {
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.HasPrefix(pdf, []byte("%PDF")) {
			t.Fatal("download is not a PDF")
		}
		return
	}
	t.Fatal("the signed PDF was not ready within 120 seconds")
}
