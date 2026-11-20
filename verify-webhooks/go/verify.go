// Package verifywebhooks verifies Standard Webhooks signatures with the standard library only.
package verifywebhooks

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strconv"
	"strings"
	"time"
)

// ErrVerification is wrapped by every verification failure.
var ErrVerification = errors.New("webhook verification failed")

func fail(reason string) error { return errors.Join(ErrVerification, errors.New(reason)) }

// Verify checks the delivery. It returns nil when authentic.
//
// secret is "whsec_<base64 key>". headers is matched case-insensitively. rawBody must be the
// exact bytes received, never a re-serialized object. now is the reference time; use time.Now().
func Verify(secret string, headers map[string]string, rawBody []byte, now time.Time, tolerance time.Duration) error {
	lower := make(map[string]string, len(headers))
	for name, value := range headers {
		lower[strings.ToLower(name)] = value
	}
	id, timestamp, signatureHeader := lower["webhook-id"], lower["webhook-timestamp"], lower["webhook-signature"]
	if id == "" || timestamp == "" || signatureHeader == "" {
		return fail("missing webhook-id, webhook-timestamp or webhook-signature header")
	}
	seconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || seconds < 0 {
		return fail("invalid webhook-timestamp")
	}
	diff := now.Sub(time.Unix(seconds, 0))
	if diff < 0 {
		diff = -diff
	}
	if diff > tolerance {
		return fail("timestamp outside the tolerance window")
	}

	key, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(secret, "whsec_"))
	if err != nil {
		return fail("secret is not valid base64")
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(id + "." + timestamp + "."))
	mac.Write(rawBody)
	expected := mac.Sum(nil)

	// The header holds space-separated "v1,<base64>" entries. Any match is enough.
	for _, entry := range strings.Fields(signatureHeader) {
		version, signature, ok := strings.Cut(entry, ",")
		if !ok || version != "v1" {
			continue
		}
		candidate, err := base64.StdEncoding.DecodeString(signature)
		if err == nil && hmac.Equal(candidate, expected) {
			return nil
		}
	}
	return fail("no matching signature")
}
