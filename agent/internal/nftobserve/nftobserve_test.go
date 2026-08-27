package nftobserve

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/MostlyCodex/lume-monitor/agent/internal/config"
)

const exampleChain = `{"nftables":[
  {"chain":{"family":"ip","table":"relay_nat","name":"prerouting"}},
  {"rule":{"family":"ip","table":"relay_nat","chain":"prerouting","comment":"lume:relay-443","expr":[
    {"match":{"op":"==","left":{"payload":{"protocol":"tcp","field":"dport"}},"right":443}},
    {"counter":{"packets":120,"bytes":7200}},
    {"dnat":{"addr":"192.0.2.10","port":443}}
  ]}}
]}`

func selector() config.NftablesCounter {
	return config.NftablesCounter{
		Name: "relay_443", Label: "443 relay", Family: "ip", Table: "relay_nat", Chain: "prerouting",
		Protocol: "tcp", DestinationPort: 443, RuleComment: "lume:relay-443", DisplayOrder: 10,
	}
}

func TestParseChainSelectsCounterWithoutReportingRuleContent(t *testing.T) {
	packets, bytes, err := ParseChain([]byte(exampleChain), selector())
	if err != nil || packets != 120 || bytes != 7200 {
		t.Fatalf("unexpected parsed counter: packets=%d bytes=%d err=%v", packets, bytes, err)
	}
}

func TestParseChainRejectsMissingAndAmbiguousSelectors(t *testing.T) {
	missing := selector()
	missing.DestinationPort = 8443
	if _, _, err := ParseChain([]byte(exampleChain), missing); err == nil {
		t.Fatal("expected missing selector to fail")
	}
	ambiguous := `{"nftables":[` + exampleChain[len(`{"nftables":[`):len(exampleChain)-2] + `,` +
		exampleChain[len(`{"nftables":[`):len(exampleChain)-2] + `]}`
	withoutComment := selector()
	withoutComment.RuleComment = ""
	if _, _, err := ParseChain([]byte(ambiguous), withoutComment); err == nil {
		t.Fatal("expected ambiguous selector to fail")
	}
}

func writeTestSnapshot(t *testing.T, path string, observedAt int64, packets uint64) {
	t.Helper()
	data, err := json.Marshal(Snapshot{
		SchemaVersion: 1,
		GeneratedAt:   observedAt,
		Counters:      []SnapshotCounter{{Name: "relay_443", Packets: packets, Bytes: packets * 60, ObservedAt: observedAt}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestTrackerComputesDeltaRateAndReset(t *testing.T) {
	path := filepath.Join(t.TempDir(), "snapshot.json")
	tracker := NewTracker()
	base := time.Now().Add(-2 * time.Minute).Unix()
	writeTestSnapshot(t, path, base, 100)
	first := tracker.Collect([]config.NftablesCounter{selector()}, path, 3*time.Minute)[0]
	if !first.Complete || !first.Baseline || first.Delta != nil {
		t.Fatalf("unexpected baseline: %+v", first)
	}
	writeTestSnapshot(t, path, base+60, 112)
	second := tracker.Collect([]config.NftablesCounter{selector()}, path, 3*time.Minute)[0]
	if second.Delta == nil || *second.Delta != 12 || second.RatePerMinute == nil || *second.RatePerMinute != 12 {
		t.Fatalf("unexpected delta: %+v", second)
	}
	writeTestSnapshot(t, path, base+120, 2)
	third := tracker.Collect([]config.NftablesCounter{selector()}, path, 3*time.Minute)[0]
	if !third.Reset || third.Delta != nil {
		t.Fatalf("unexpected reset handling: %+v", third)
	}
}
