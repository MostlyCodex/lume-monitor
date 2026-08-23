//go:build linux

package collect

import "testing"

func BenchmarkCollectLinuxHost(b *testing.B) {
	collector := New()
	_, _ = collector.Collect() // Prime the CPU delta collector.
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		_, _ = collector.Collect()
	}
}
