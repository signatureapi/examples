package verifywebhooks

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

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
	data, err := os.ReadFile("../test-vector.json")
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
	now := time.Unix(v.Now, 0)
	tolerance := time.Duration(v.Tolerance) * time.Second
	for _, c := range v.Cases {
		t.Run(c.Name, func(t *testing.T) {
			err := Verify(v.Secret, c.Headers, []byte(c.Body), now, tolerance)
			if c.Expect == "valid" && err != nil {
				t.Fatalf("expected valid, got %v", err)
			}
			if c.Expect != "valid" && err == nil {
				t.Fatal("expected failure, got nil")
			}
		})
	}
}

func TestHeaderNamesAreCaseInsensitive(t *testing.T) {
	v := loadVector(t)
	upper := map[string]string{}
	for k, val := range v.Cases[0].Headers {
		upper[strings.ToUpper(k)] = val
	}
	if err := Verify(v.Secret, upper, []byte(v.Cases[0].Body), time.Unix(v.Now, 0), 5*time.Minute); err != nil {
		t.Fatal(err)
	}
}
