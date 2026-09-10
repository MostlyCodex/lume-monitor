//go:build linux

package collect

import (
	"encoding/json"
	"testing"
)

func TestCollectHardwareCapacity(t *testing.T) {
	metrics, _ := New().Collect()
	if metrics.CPUCount < 1 || metrics.MemoryTotalBytes == 0 || metrics.RootTotalBytes == 0 {
		t.Fatalf("missing host capacity: CPU=%d memory=%d disk=%d", metrics.CPUCount, metrics.MemoryTotalBytes, metrics.RootTotalBytes)
	}
	body, err := json.Marshal(metrics)
	if err != nil {
		t.Fatal(err)
	}
	var capacity struct {
		CPUCount int `json:"cpu_count"`
	}
	if err := json.Unmarshal(body, &capacity); err != nil {
		t.Fatal(err)
	}
	if capacity.CPUCount < 1 {
		t.Fatal("CPU capacity is missing from the wire report")
	}
}

func BenchmarkCollectLinuxHost(b *testing.B) {
	collector := New()
	_, _ = collector.Collect() // Prime the CPU delta collector.
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		_, _ = collector.Collect()
	}
}
