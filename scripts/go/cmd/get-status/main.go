// Print the status of an envelope and each of its recipients.
// Usage: go run ./cmd/get-status <envelope-id>
package main

import (
	"fmt"
	"os"

	"example.com/signatureapi-scripts/signatureapi"
)

func main() {
	if len(os.Args) < 2 {
		fail("Usage: go run ./cmd/get-status <envelope-id>")
	}
	cfg, err := signatureapi.FromEnv()
	if err != nil {
		fail(err.Error())
	}
	envelope, err := cfg.GetEnvelope(os.Args[1])
	if err != nil {
		fail(err.Error())
	}
	fmt.Printf("Envelope %s: %s\n", envelope.ID, envelope.Status)
	for _, r := range envelope.Recipients {
		fmt.Printf("  %s (%s): %s\n", r.Key, r.Type, r.Status)
	}
	if envelope.Deliverable != nil {
		fmt.Printf("Deliverable %s: %s\n", envelope.Deliverable.ID, envelope.Deliverable.Status)
	}
}

func fail(message string) {
	fmt.Fprintln(os.Stderr, "Error:", message)
	os.Exit(1)
}
