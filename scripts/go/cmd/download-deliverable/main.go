// Download the signed PDF (deliverable) of a completed envelope.
// Usage: go run ./cmd/download-deliverable <envelope-id> [output.pdf]
package main

import (
	"fmt"
	"os"

	"example.com/signatureapi-scripts/signatureapi"
)

func main() {
	if len(os.Args) < 2 {
		fail("Usage: go run ./cmd/download-deliverable <envelope-id> [output.pdf]")
	}
	output := "signed-envelope.pdf"
	if len(os.Args) > 2 {
		output = os.Args[2]
	}
	cfg, err := signatureapi.FromEnv()
	if err != nil {
		fail(err.Error())
	}
	id, size, err := cfg.DownloadDeliverable(os.Args[1], output)
	if err != nil {
		fail(err.Error())
	}
	fmt.Printf("Saved deliverable %s to %s (%d bytes)\n", id, output, size)
}

func fail(message string) {
	fmt.Fprintln(os.Stderr, "Error:", message)
	os.Exit(1)
}
