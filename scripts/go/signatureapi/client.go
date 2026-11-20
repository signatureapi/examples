// Package signatureapi is a tiny, dependency-free client for the three calls these scripts need.
package signatureapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const DefaultBaseURL = "https://api.signatureapi.com"

// Config holds the API key and base URL. Build it with FromEnv.
type Config struct {
	APIKey  string
	BaseURL string
	HTTP    *http.Client
}

// FromEnv reads SIGNATUREAPI_KEY and SIGNATUREAPI_BASE_URL. Test keys only.
func FromEnv() (Config, error) {
	key := os.Getenv("SIGNATUREAPI_KEY")
	if key == "" {
		return Config{}, errors.New("set SIGNATUREAPI_KEY to your test API key (it starts with key_test_)")
	}
	if !strings.HasPrefix(key, "key_test_") {
		return Config{}, errors.New("these examples run in test mode only: use a key that starts with key_test_")
	}
	base := os.Getenv("SIGNATUREAPI_BASE_URL")
	if base == "" {
		base = DefaultBaseURL
	}
	return Config{APIKey: key, BaseURL: strings.TrimRight(base, "/"), HTTP: &http.Client{Timeout: 30 * time.Second}}, nil
}

// APIError is returned for any non-2xx response.
type APIError struct {
	Status int
	Body   string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("SignatureAPI returned %d: %s", e.Status, e.Body)
}

func (c Config) do(method, path string, payload any, out any) error {
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
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return &APIError{Status: resp.StatusCode, Body: string(data)}
	}
	return json.Unmarshal(data, out)
}

type Recipient struct {
	Key    string `json:"key"`
	Type   string `json:"type"`
	Name   string `json:"name"`
	Email  string `json:"email"`
	Status string `json:"status"`
}

type Deliverable struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	URL    string `json:"url"`
}

type Envelope struct {
	ID          string       `json:"id"`
	Status      string       `json:"status"`
	Recipients  []Recipient  `json:"recipients"`
	Deliverable *Deliverable `json:"deliverable"`
}

// SamplePDFURL is a public one-page PDF with no [[placeholders]], so places need fixed positions.
const SamplePDFURL = "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf"

// BuildServiceAgreement builds a one-signer envelope for the sample Service Agreement.
func BuildServiceAgreement(name, email string) map[string]any {
	return map[string]any{
		"title":    "Service Agreement",
		"message":  "Hi, please review and sign the Acme Corp Service Agreement.",
		"metadata": map[string]any{},
		"documents": []any{map[string]any{
			"url":    SamplePDFURL,
			"format": "pdf",
			"places": []any{map[string]any{"key": "client_signature", "type": "signature", "recipient_key": "client"}},
			// top and left: points from the top and left edges of page 1 to the bottom-left corner of the place.
			"fixed_positions": []any{map[string]any{"place_key": "client_signature", "page": 1, "top": 172, "left": 210}},
		}},
		"recipients": []any{map[string]any{"key": "client", "type": "signer", "name": name, "email": email}},
	}
}

// SendEnvelope calls POST /v1/envelopes.
func (c Config) SendEnvelope(name, email string) (Envelope, error) {
	var e Envelope
	err := c.do(http.MethodPost, "/v1/envelopes", BuildServiceAgreement(name, email), &e)
	return e, err
}

// GetEnvelope calls GET /v1/envelopes/{id}.
func (c Config) GetEnvelope(id string) (Envelope, error) {
	var e Envelope
	err := c.do(http.MethodGet, "/v1/envelopes/"+url.PathEscape(id), nil, &e)
	return e, err
}

// DownloadDeliverable saves the signed PDF of a completed envelope and returns the byte count.
func (c Config) DownloadDeliverable(envelopeID, outputPath string) (string, int, error) {
	e, err := c.GetEnvelope(envelopeID)
	if err != nil {
		return "", 0, err
	}
	if e.Status != "completed" {
		return "", 0, fmt.Errorf("envelope is %s: the deliverable exists once the envelope is completed", e.Status)
	}
	if e.Deliverable == nil {
		return "", 0, errors.New("the envelope has no deliverable yet: try again in a few seconds")
	}
	var d Deliverable
	if err := c.do(http.MethodGet, "/v1/deliverables/"+url.PathEscape(e.Deliverable.ID), nil, &d); err != nil {
		return "", 0, err
	}
	if d.Status != "generated" {
		return "", 0, fmt.Errorf("deliverable is %s: try again once it is generated", d.Status)
	}
	// d.URL is a pre-signed link that expires after 1 hour. Do not send the API key to it.
	resp, err := c.HTTP.Get(d.URL)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", 0, fmt.Errorf("download failed with %d", resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", 0, err
	}
	return d.ID, len(data), os.WriteFile(outputPath, data, 0o644)
}
