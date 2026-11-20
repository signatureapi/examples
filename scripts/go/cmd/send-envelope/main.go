// Send the sample Service Agreement to one signer.
// Usage: go run ./cmd/send-envelope [name] [email]
package main

import (
	"fmt"
	"os"

	"example.com/signatureapi-scripts/signatureapi"
)

func main() {
	name, email := "Jane Doe", "jane.doe@example.com"
	if len(os.Args) > 2 {
		name, email = os.Args[1], os.Args[2]
	}
	cfg, err := signatureapi.FromEnv()
	exitOn(err)
	envelope, err := cfg.SendEnvelope(name, email)
	exitOn(err)
	fmt.Printf("Envelope created: %s\n", envelope.ID)
	fmt.Printf("Status: %s\n", envelope.Status)
	for _, r := range envelope.Recipients {
		fmt.Printf("Recipient %s: %s <%s> (%s)\n", r.Key, r.Name, r.Email, r.Status)
	}
}

func exitOn(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
}
