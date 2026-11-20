// Usage: SIGNATUREAPI_WEBHOOK_SECRET=whsec_... go run ./cmd/verify [delivery.json]
// Without an argument it checks the valid case from the shared test vector.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"time"

	verifywebhooks "example.com/verifywebhooks"
)

type delivery struct {
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

func main() {
	secret := os.Getenv("SIGNATUREAPI_WEBHOOK_SECRET")
	var d delivery
	now := time.Now()
	if len(os.Args) > 1 {
		data, err := os.ReadFile(os.Args[1])
		check(err)
		check(json.Unmarshal(data, &d))
	} else {
		data, err := os.ReadFile("../test-vector.json")
		check(err)
		var v struct {
			Secret string     `json:"secret"`
			Now    int64      `json:"now"`
			Cases  []delivery `json:"cases"`
		}
		check(json.Unmarshal(data, &v))
		d, now = v.Cases[0], time.Unix(v.Now, 0)
		if secret == "" {
			secret = v.Secret
		}
	}
	if err := verifywebhooks.Verify(secret, d.Headers, []byte(d.Body), now, 5*time.Minute); err != nil {
		fmt.Fprintln(os.Stderr, "invalid:", err)
		os.Exit(1)
	}
	fmt.Println("valid signature")
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
}
