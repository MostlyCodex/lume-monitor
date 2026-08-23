package sender

import "testing"

func BenchmarkReportSignature(b *testing.B) {
	secret := []byte("benchmark-secret-with-32-characters")
	body := make([]byte, 4096)
	b.SetBytes(int64(len(body)))
	b.ReportAllocs()
	for range b.N {
		_ = signature(secret, "1787472000", "benchmark-nonce-12345678", body)
	}
}
