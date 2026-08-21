package sender

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

type Sender struct {
	endpoint string
	nodeID   string
	secret   []byte
	client   *http.Client
}

func New(endpoint, nodeID, secret, version string) *Sender {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConns = 4
	transport.MaxIdleConnsPerHost = 2
	transport.IdleConnTimeout = 90 * time.Second
	return &Sender{
		endpoint: endpoint,
		nodeID:   nodeID,
		secret:   []byte(secret),
		client: &http.Client{
			Timeout:   12 * time.Second,
			Transport: &userAgentTransport{base: transport, userAgent: "vpsmon-agent/" + version},
		},
	}
}

type userAgentTransport struct {
	base      http.RoundTripper
	userAgent string
}

func (t *userAgentTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	request.Header.Set("User-Agent", t.userAgent)
	return t.base.RoundTrip(request)
}

func nonce() (string, error) {
	value := make([]byte, 18)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func signature(secret []byte, timestamp, requestNonce string, body []byte) string {
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(timestamp))
	_, _ = mac.Write([]byte("\n"))
	_, _ = mac.Write([]byte(requestNonce))
	_, _ = mac.Write([]byte("\n"))
	_, _ = mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

func (s *Sender) Send(ctx context.Context, body []byte) error {
	requestNonce, err := nonce()
	if err != nil {
		return fmt.Errorf("create nonce: %w", err)
	}
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Vpsmon-Node", s.nodeID)
	request.Header.Set("X-Vpsmon-Timestamp", timestamp)
	request.Header.Set("X-Vpsmon-Nonce", requestNonce)
	request.Header.Set("X-Vpsmon-Signature", "sha256="+signature(s.secret, timestamp, requestNonce, body))
	response, err := s.client.Do(request)
	if err != nil {
		return fmt.Errorf("send report: %w", err)
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("report endpoint returned HTTP %d", response.StatusCode)
	}
	return nil
}
