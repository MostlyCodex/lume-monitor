package sender

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSenderSignsCanonicalRequest(t *testing.T) {
	secret := strings.Repeat("s", 32)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		body, _ := io.ReadAll(request.Body)
		canonical := request.Header.Get("X-Vpsmon-Timestamp") + "\n" + request.Header.Get("X-Vpsmon-Nonce") + "\n" + string(body)
		mac := hmac.New(sha256.New, []byte(secret))
		_, _ = mac.Write([]byte(canonical))
		expected := hex.EncodeToString(mac.Sum(nil))
		if request.Header.Get("X-Vpsmon-Signature") != "sha256="+expected {
			t.Errorf("signature mismatch")
		}
		if request.Header.Get("X-Vpsmon-Node") != "a" {
			t.Errorf("node header mismatch")
		}
		response.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	s := New(server.URL, "a", secret, "test")
	if err := s.Send(context.Background(), []byte(`{"ok":true}`)); err != nil {
		t.Fatalf("Send() error = %v", err)
	}
}
