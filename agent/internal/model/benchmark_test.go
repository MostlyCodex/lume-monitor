package model

import (
	"encoding/json"
	"testing"
)

func representativeReport() Report {
	probes := make([]ProbeResult, 4)
	for index := range probes {
		probes[index] = ProbeResult{
			Name: "beijing_carrier_icmp_" + string(rune('1'+index)), Label: "Beijing carrier", Category: "carrier-reference",
			Kind: "icmp", WarningMS: 200, CriticalMS: 350,
			WarningFailurePercent: 5, CriticalFailurePercent: 30, Severity: "P2",
			DisplayOrder: (index + 1) * 10, Success: true, Complete: true, DurationMS: 151.2,
			Samples: 5, AttemptedSamples: 5, SuccessfulSamples: 5, CheckedAt: 1787472000,
		}
	}
	return Report{
		SchemaVersion: 2, AgentVersion: "benchmark", NodeID: "benchmark-node",
		Node: NodeMetadata{
			ID: "benchmark-node", DisplayName: "Benchmark Node", Role: "VPS", Region: "Test Region",
			StaleSeconds: 180, DisplayOrder: 100, IPChangeSeverity: "P2",
		},
		GeneratedAt: 1787472000,
		System: SystemMetrics{
			Hostname: "benchmark", OS: "Linux", Kernel: "6.x",
			BootID: "00000000-0000-0000-0000-000000000000", UptimeSeconds: 86400, CPUPercent: 3.2,
			MemoryTotalBytes: 1 << 30, MemoryAvailableBytes: 800 << 20,
			RootTotalBytes: 20 << 30, RootUsedPercent: 25,
			NetworkRXBytes: 1 << 30, NetworkTXBytes: 2 << 30,
		},
		Services: []ServiceStatus{{Name: "example.service", Label: "Example", Severity: "P1", State: "active"}},
		Probes:   probes,
		Agent:    AgentHealth{StartedAt: 1787468400},
	}
}

func TestRepresentativeReportFitsWorkerLimit(t *testing.T) {
	payload, err := json.Marshal(representativeReport())
	if err != nil {
		t.Fatal(err)
	}
	if len(payload) >= 64*1024 {
		t.Fatalf("representative report is %d bytes; Worker limit is 65536", len(payload))
	}
}

func BenchmarkMarshalRepresentativeReport(b *testing.B) {
	report := representativeReport()
	payload, err := json.Marshal(report)
	if err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		if _, err := json.Marshal(report); err != nil {
			b.Fatal(err)
		}
	}
	b.StopTimer()
	b.ReportMetric(float64(len(payload)), "payload_B")
}
