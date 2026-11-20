// Go tutorial app: send a contract, sign it in an embedded ceremony, track it with webhooks.
//
// Run: go run .
package main

import (
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"regexp"
	"sync"
	"time"
)

//go:embed index.html
var page []byte

type contract struct {
	Status string
	Events []string
}

type server struct {
	cfg Config
	mu  sync.Mutex
	// In production these live in your database.
	contracts      map[string]*contract
	seenWebhookIDs map[string]bool
}

var uuidPath = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func newServer(cfg Config) http.Handler {
	s := &server{cfg: cfg, contracts: map[string]*contract{}, seenWebhookIDs: map[string]bool{}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(page)
	})
	mux.HandleFunc("POST /api/contracts", s.createContract)
	mux.HandleFunc("GET /api/contracts/{id}", s.contractStatus)
	mux.HandleFunc("GET /api/contracts/{id}/signed.pdf", s.signedPDF)
	mux.HandleFunc("POST /webhooks/signatureapi", s.webhook)
	return mux
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}

// fail maps an error to a JSON answer: 409 when the PDF is not ready, 502 for any SignatureAPI problem.
func fail(w http.ResponseWriter, err error) {
	var notReady errNotReady
	if errors.As(err, &notReady) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
}

// Step 1: your server creates the envelope and hands the ceremony URL to the browser.
func (s *server) createContract(w http.ResponseWriter, r *http.Request) {
	var input struct{ Name, Email string }
	_ = json.NewDecoder(r.Body).Decode(&input)
	if input.Name == "" || input.Email == "" {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "name and email are required"})
		return
	}
	suffix := make([]byte, 4)
	rand.Read(suffix)
	userID := "usr_" + hex.EncodeToString(suffix) // your signed-in user's id
	id, ceremonyURL, err := s.cfg.createSigningSession(input.Name, input.Email, userID)
	if err != nil {
		fail(w, err)
		return
	}
	s.mu.Lock()
	s.contracts[id] = &contract{Status: "in_progress", Events: []string{}}
	s.mu.Unlock()
	writeJSON(w, http.StatusCreated, map[string]string{"envelopeId": id, "ceremonyUrl": ceremonyURL})
}

// Step 4: confirm the real state on the server before acting on a browser event.
func (s *server) contractStatus(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !uuidPath.MatchString(id) {
		http.NotFound(w, r)
		return
	}
	var envelope Envelope
	if err := s.cfg.api("GET", "/v1/envelopes/"+id, nil, &envelope); err != nil {
		fail(w, err)
		return
	}
	events := []string{}
	s.mu.Lock()
	if c := s.contracts[envelope.ID]; c != nil {
		events = append(events, c.Events...)
	}
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"envelopeId": envelope.ID, "status": envelope.Status, "webhookEvents": events})
}

// Step 5: stream the signed PDF through your server, so the browser never needs your API key.
func (s *server) signedPDF(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !uuidPath.MatchString(id) {
		http.NotFound(w, r)
		return
	}
	pdf, err := s.cfg.downloadSignedPDF(id)
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", `attachment; filename="signed-service-agreement.pdf"`)
	w.Write(pdf)
}

// Step 3: SignatureAPI calls this endpoint. Verify the RAW body (the bytes io.ReadAll returns), never re-serialized JSON.
func (s *server) webhook(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err == nil {
		err = verifyWebhook(s.cfg.WebhookSecret, r.Header, raw, time.Now(), 300*time.Second)
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	var event struct {
		Type string `json:"type"`
		Data struct {
			EnvelopeID string `json:"envelope_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &event); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "body is not JSON"})
		return
	}
	webhookID := r.Header.Get("webhook-id")
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.seenWebhookIDs[webhookID] {
		writeJSON(w, http.StatusOK, map[string]bool{"duplicate": true})
		return
	}
	s.seenWebhookIDs[webhookID] = true
	record := s.contracts[event.Data.EnvelopeID]
	if record == nil {
		record = &contract{Status: "unknown", Events: []string{}}
		s.contracts[event.Data.EnvelopeID] = record
	}
	record.Events = append(record.Events, event.Type)
	if event.Type == "envelope.completed" {
		record.Status = "completed"
	}
	log.Printf("webhook %s for envelope %s", event.Type, event.Data.EnvelopeID)
	writeJSON(w, http.StatusOK, map[string]bool{"received": true})
}

func main() {
	cfg, err := configFromEnv()
	if err != nil {
		log.Fatal(err)
	}
	log.Println("listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", newServer(cfg)))
}
