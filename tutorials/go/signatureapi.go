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
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is read once at startup. Build it with configFromEnv.
type Config struct {
	APIKey        string
	BaseURL       string
	WebhookSecret string
	AppOrigin     string
}

func configFromEnv() (Config, error) {
	key := os.Getenv("SIGNATUREAPI_KEY")
	if !strings.HasPrefix(key, "key_test_") {
		return Config{}, errors.New("set SIGNATUREAPI_KEY to a test API key (it starts with key_test_)")
	}
	return Config{
		APIKey:        key,
		BaseURL:       strings.TrimRight(envOr("SIGNATUREAPI_BASE_URL", "https://api.signatureapi.com"), "/"),
		WebhookSecret: os.Getenv("SIGNATUREAPI_WEBHOOK_SECRET"),
		AppOrigin:     envOr("APP_ORIGIN", "http://localhost:8080"),
	}, nil
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

// APIError is returned for any non-2xx response from SignatureAPI.
type APIError struct {
	Status int
	Detail string
}

func (e *APIError) Error() string {
	if e.Status == 0 {
		return e.Detail
	}
	if e.Detail == "" {
		return fmt.Sprintf("SignatureAPI returned %d", e.Status)
	}
	return fmt.Sprintf("SignatureAPI returned %d: %s", e.Status, e.Detail)
}

var httpClient = &http.Client{Timeout: 60 * time.Second}

func (c Config) api(method, path string, payload any, out any) error {
	var body io.Reader
	if payload != nil {
		data, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, c.BaseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("X-API-Key", c.APIKey)
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		var problem struct{ Detail, Title string }
		_ = json.Unmarshal(data, &problem)
		return &APIError{Status: resp.StatusCode, Detail: cmpOr(problem.Detail, problem.Title)}
	}
	return json.Unmarshal(data, out)
}

func cmpOr(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

type Envelope struct {
	ID         string `json:"id"`
	Status     string `json:"status"`
	Recipients []struct {
		Ceremony struct {
			URL string `json:"url"`
		} `json:"ceremony"`
	} `json:"recipients"`
	Deliverable *struct {
		ID string `json:"id"`
	} `json:"deliverable"`
}

// buildContract is the envelope for an embedded ceremony: custom authentication, embeddable_in, no email delivery.
func buildContract(name, email, userID, appOrigin string) map[string]any {
	return map[string]any{
		"title":    "Service Agreement",
		"metadata": map[string]any{"app_user_id": userID},
		"documents": []any{map[string]any{
			"url":             "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
			"format":          "pdf",
			"places":          []any{map[string]any{"key": "client_signature", "type": "signature", "recipient_key": "client"}},
			"fixed_positions": []any{map[string]any{"place_key": "client_signature", "page": 1, "top": 172, "left": 210}},
		}},
		"recipients": []any{map[string]any{
			"key":           "client",
			"type":          "signer",
			"name":          name,
			"email":         email,
			"delivery_type": "none",
			"ceremony": map[string]any{
				"authentication": []any{map[string]any{"type": "custom", "provider": "Acme Corp Portal", "data": map[string]any{"user_id": userID}}},
				"embeddable_in":  []any{appOrigin},
			},
		}},
	}
}

// createSigningSession creates the envelope and waits until the ceremony can open.
// The ceremony refuses to open while the envelope is processing, so poll until it is in_progress.
func (c Config) createSigningSession(name, email, userID string) (envelopeID, ceremonyURL string, err error) {
	var envelope Envelope
	if err = c.api("POST", "/v1/envelopes", buildContract(name, email, userID, c.AppOrigin), &envelope); err != nil {
		return
	}
	for attempt := 0; envelope.Status == "processing" && attempt < 30; attempt++ {
		time.Sleep(time.Second)
		if err = c.api("GET", "/v1/envelopes/"+envelope.ID, nil, &envelope); err != nil {
			return
		}
	}
	if envelope.Status != "in_progress" || len(envelope.Recipients) == 0 {
		return "", "", &APIError{Detail: fmt.Sprintf("Envelope is %s, not ready for signing", envelope.Status)}
	}
	return envelope.ID, envelope.Recipients[0].Ceremony.URL, nil
}

// errNotReady means the deliverable does not exist yet. The app answers 409 and the user tries again.
type errNotReady string

func (e errNotReady) Error() string { return string(e) }

// downloadSignedPDF downloads the signed PDF of a completed envelope.
// The deliverable URL is pre-signed and expires after 1 hour, so fetch a fresh one each time
// instead of storing it. It needs no API key.
func (c Config) downloadSignedPDF(envelopeID string) ([]byte, error) {
	var envelope Envelope
	if err := c.api("GET", "/v1/envelopes/"+envelopeID, nil, &envelope); err != nil {
		return nil, err
	}
	if envelope.Status != "completed" || envelope.Deliverable == nil {
		return nil, errNotReady(fmt.Sprintf("Envelope is %s. The signed PDF exists once it is completed.", envelope.Status))
	}
	var deliverable struct{ Status, URL string }
	if err := c.api("GET", "/v1/deliverables/"+envelope.Deliverable.ID, nil, &deliverable); err != nil {
		return nil, err
	}
	if deliverable.Status != "generated" {
		return nil, errNotReady(fmt.Sprintf("Deliverable is %s. Try again in a few seconds.", deliverable.Status))
	}
	resp, err := httpClient.Get(deliverable.URL) // no API key on this request
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, &APIError{Status: resp.StatusCode}
	}
	return io.ReadAll(resp.Body)
}

var errWebhook = errors.New("webhook verification failed")

// verifyWebhook runs Standard Webhooks verification on the raw body. It returns nil when the delivery is authentic.
func verifyWebhook(secret string, header http.Header, rawBody []byte, now time.Time, tolerance time.Duration) error {
	id, timestamp, signatures := header.Get("webhook-id"), header.Get("webhook-timestamp"), header.Get("webhook-signature")
	if id == "" || timestamp == "" || signatures == "" {
		return fmt.Errorf("%w: missing webhook headers", errWebhook)
	}
	seconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || seconds < 0 {
		return fmt.Errorf("%w: invalid timestamp", errWebhook)
	}
	age := now.Sub(time.Unix(seconds, 0))
	if age < -tolerance || age > tolerance {
		return fmt.Errorf("%w: timestamp outside the tolerance window", errWebhook)
	}
	key, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(secret, "whsec_"))
	if err != nil {
		return fmt.Errorf("%w: secret is not valid base64", errWebhook)
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(id + "." + timestamp + "."))
	mac.Write(rawBody)
	expected := mac.Sum(nil)
	for _, entry := range strings.Fields(signatures) {
		version, value, _ := strings.Cut(entry, ",")
		candidate, err := base64.StdEncoding.DecodeString(value)
		if version == "v1" && err == nil && hmac.Equal(candidate, expected) {
			return nil
		}
	}
	return fmt.Errorf("%w: invalid signature", errWebhook)
}
