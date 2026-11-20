package signatureapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

const (
	envelopeID    = "eb4cf433-a8af-4161-b37b-7ef57d423e56"
	deliverableID = "del_5hN8sD2jKq7WxZ4mPv9Ta3"
	fakeKey       = "key_test_fake"
)

type seenRequest struct {
	Method, Path, Key string
	Body              map[string]any
}

// newMock starts a local API and records every request it receives.
func newMock(t *testing.T) (Config, *[]seenRequest) {
	t.Helper()
	var mu sync.Mutex
	var seen []seenRequest
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		mu.Lock()
		seen = append(seen, seenRequest{r.Method, r.URL.Path, r.Header.Get("X-API-Key"), body})
		mu.Unlock()
		reply := func(status int, v any) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(v)
		}
		if r.URL.Path == "/signed.pdf" {
			if r.Header.Get("X-API-Key") != "" {
				http.Error(w, "key leaked", http.StatusBadRequest)
				return
			}
			_, _ = w.Write([]byte("%PDF-1.4 mock"))
			return
		}
		if r.Header.Get("X-API-Key") != fakeKey {
			reply(401, map[string]string{"title": "Unauthorized"})
			return
		}
		switch {
		case r.Method == "POST" && r.URL.Path == "/v1/envelopes":
			reply(201, map[string]any{"id": envelopeID, "status": "processing",
				"recipients": []any{map[string]any{"key": "client", "type": "signer", "name": "Jane Doe", "email": "jane.doe@example.com", "status": "pending"}}})
		case r.Method == "GET" && r.URL.Path == "/v1/envelopes/"+envelopeID:
			reply(200, map[string]any{"id": envelopeID, "status": "completed", "recipients": []any{},
				"deliverable": map[string]any{"id": deliverableID, "status": "generated"}})
		case r.Method == "GET" && r.URL.Path == "/v1/deliverables/"+deliverableID:
			reply(200, map[string]any{"id": deliverableID, "status": "generated", "url": srv.URL + "/signed.pdf"})
		default:
			reply(404, map[string]string{"title": "Not Found"})
		}
	}))
	t.Cleanup(srv.Close)
	return Config{APIKey: fakeKey, BaseURL: srv.URL, HTTP: srv.Client()}, &seen
}

func TestFromEnv(t *testing.T) {
	t.Setenv("SIGNATUREAPI_KEY", "")
	if _, err := FromEnv(); err == nil {
		t.Fatal("expected an error without a key")
	}
	t.Setenv("SIGNATUREAPI_KEY", "key_live_x")
	if _, err := FromEnv(); err == nil || !strings.Contains(err.Error(), "test mode only") {
		t.Fatalf("expected a test mode error, got %v", err)
	}
	t.Setenv("SIGNATUREAPI_KEY", fakeKey)
	t.Setenv("SIGNATUREAPI_BASE_URL", "http://x/")
	cfg, err := FromEnv()
	if err != nil || cfg.BaseURL != "http://x" {
		t.Fatalf("unexpected config %+v %v", cfg, err)
	}
}

func TestSendEnvelope(t *testing.T) {
	cfg, seen := newMock(t)
	e, err := cfg.SendEnvelope("Jane Doe", "jane.doe@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if e.ID != envelopeID {
		t.Fatalf("id %q", e.ID)
	}
	req := (*seen)[0]
	if req.Method != "POST" || req.Path != "/v1/envelopes" || req.Key != fakeKey {
		t.Fatalf("unexpected request %+v", req)
	}
	data, err := os.ReadFile(filepath.Join("expected-envelope.json"))
	if err != nil {
		t.Fatal(err)
	}
	var want map[string]any
	_ = json.Unmarshal(data, &want)
	// Round trip through JSON so numbers compare as float64 on both sides.
	if !reflect.DeepEqual(req.Body, want) {
		t.Fatalf("body mismatch\n got: %v\nwant: %v", req.Body, want)
	}
}

func TestGetEnvelope(t *testing.T) {
	cfg, seen := newMock(t)
	e, err := cfg.GetEnvelope(envelopeID)
	if err != nil || e.Status != "completed" {
		t.Fatalf("%+v %v", e, err)
	}
	if r := (*seen)[0]; r.Method != "GET" || r.Path != "/v1/envelopes/"+envelopeID || r.Key != fakeKey {
		t.Fatalf("unexpected request %+v", r)
	}
}

func TestDownloadDeliverableDoesNotLeakTheKey(t *testing.T) {
	cfg, seen := newMock(t)
	out := filepath.Join(t.TempDir(), "signed.pdf")
	id, size, err := cfg.DownloadDeliverable(envelopeID, out)
	if err != nil || id != deliverableID || size == 0 {
		t.Fatalf("%q %d %v", id, size, err)
	}
	if data, _ := os.ReadFile(out); !strings.HasPrefix(string(data), "%PDF") {
		t.Fatalf("not a PDF: %q", data)
	}
	paths := []string{}
	for _, r := range *seen {
		paths = append(paths, r.Method+" "+r.Path)
	}
	want := []string{"GET /v1/envelopes/" + envelopeID, "GET /v1/deliverables/" + deliverableID, "GET /signed.pdf"}
	if !reflect.DeepEqual(paths, want) {
		t.Fatalf("calls %v", paths)
	}
	if (*seen)[2].Key != "" {
		t.Fatal("the API key was sent to the pre-signed URL")
	}
}

func TestUnauthorizedReturnsAPIError(t *testing.T) {
	cfg, _ := newMock(t)
	cfg.APIKey = "key_test_wrong"
	_, err := cfg.GetEnvelope(envelopeID)
	apiErr, ok := err.(*APIError)
	if !ok || apiErr.Status != 401 {
		t.Fatalf("expected a 401 APIError, got %v", err)
	}
}

// Live test: runs only with a test key, creates a real test-mode envelope and reads it back.
func TestLive(t *testing.T) {
	if os.Getenv("SIGNATUREAPI_KEY") == "" {
		t.Skip("SIGNATUREAPI_KEY is not set: skipping the live test")
	}
	cfg, err := FromEnv()
	if err != nil {
		t.Fatal(err)
	}
	e, err := cfg.SendEnvelope("Jane Doe", "jane.doe@example.com")
	if err != nil {
		t.Fatal(err)
	}
	got, err := cfg.GetEnvelope(e.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != e.ID {
		t.Fatalf("id mismatch %s != %s", got.ID, e.ID)
	}
}
