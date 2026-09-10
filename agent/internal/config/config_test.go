package config

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestLoadDiscardsRetiredObserverAndStillRejectsUnknownFields(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Load requires Unix file permissions")
	}
	original := baseConfig()
	original.Probes = []Probe{{Name: "reference", Kind: "icmp", Target: "192.0.2.1"}}
	body, _ := json.Marshal(original)
	var values map[string]any
	if err := json.Unmarshal(body, &values); err != nil {
		t.Fatal(err)
	}
	values["nftables_counters"] = []any{map[string]any{"name": "old-rule"}}
	path := filepath.Join(t.TempDir(), "config.json")
	write := func() {
		t.Helper()
		body, err := json.Marshal(values)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, body, 0600); err != nil {
			t.Fatal(err)
		}
	}
	write()
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Probes) != 1 || cfg.Secret != original.Secret {
		t.Fatal("upgrade lost current configuration")
	}
	body, _ = json.Marshal(cfg)
	var current map[string]any
	if err := json.Unmarshal(body, &current); err != nil {
		t.Fatal(err)
	}
	if _, exists := current["nftables_counters"]; exists {
		t.Fatal("retired field survived upgrade")
	}
	values["unknown_field"] = true
	write()
	if _, err := Load(path); err == nil {
		t.Fatal("unknown fields must still be rejected")
	}
}

func baseConfig() Config {
	return Config{
		Node:     Node{ID: "future-vps-01"},
		Endpoint: "https://example.workers.dev/api/v1/report",
		Secret:   "01234567890123456789012345678901",
	}
}

func TestValidateAppliesGenericSafeDefaults(t *testing.T) {
	cfg := baseConfig()
	cfg.Services = []Service{{Name: "example.service"}}
	cfg.Probes = []Probe{{Name: "peer_icmp", Kind: "icmp", Target: "peer.example"}}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	if cfg.ReportIntervalSeconds != 60 || cfg.ProbeIntervalSeconds != 60 || cfg.Probes[0].TimeoutSeconds != 4 ||
		cfg.Probes[0].Samples != 5 || cfg.Probes[0].SampleIntervalMS != 250 {
		t.Fatalf("safe defaults not applied: %+v", cfg)
	}
	if cfg.Node.DisplayName != "future-vps-01" || cfg.Node.Role != "VPS" || cfg.Node.OfflineSeverity != "P1" {
		t.Fatalf("node defaults not applied: %+v", cfg.Node)
	}
	if cfg.Services[0].Label != "example.service" || cfg.Services[0].Severity != "P1" {
		t.Fatalf("service defaults not applied: %+v", cfg.Services[0])
	}
	if cfg.Probes[0].Label != "peer_icmp" || cfg.Probes[0].Category != "custom" || cfg.Probes[0].Severity != "P2" {
		t.Fatalf("probe defaults not applied: %+v", cfg.Probes[0])
	}
}

func TestValidateAcceptsArbitraryNodeAndOptionalChecks(t *testing.T) {
	cfg := baseConfig()
	if err := cfg.Validate(); err != nil {
		t.Fatalf("plain host monitoring config was rejected: %v", err)
	}
	if len(cfg.Services) != 0 || len(cfg.Probes) != 0 {
		t.Fatalf("optional checks should remain empty: %+v", cfg)
	}
}

func TestValidateRejectsInsecureEndpoint(t *testing.T) {
	cfg := baseConfig()
	cfg.Endpoint = "http://example/api/v1/report"
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected insecure endpoint to be rejected")
	}
}

func TestValidateRejectsServiceArgumentInjection(t *testing.T) {
	cfg := baseConfig()
	cfg.Services = []Service{{Name: "example.service --now"}}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected invalid service name to be rejected")
	}
}

func TestValidateRejectsInvalidProbeThresholds(t *testing.T) {
	cfg := baseConfig()
	cfg.Probes = []Probe{{
		Name: "peer_icmp", Kind: "icmp", Target: "peer.example", WarningMS: 50, CriticalMS: 20,
	}}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected inverted latency thresholds to be rejected")
	}
}

func TestValidateRequiresTargetNodeForNodeLink(t *testing.T) {
	cfg := baseConfig()
	cfg.Probes = []Probe{{
		Name: "peer_icmp", Category: "node-link", Kind: "icmp", Target: "peer.example",
	}}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected node-link without target_node_id to be rejected")
	}
}

func TestValidateRejectsNonICMPProbeKinds(t *testing.T) {
	for _, kind := range []string{"tls", "http", "exec"} {
		cfg := baseConfig()
		cfg.Probes = []Probe{{Name: "unsupported_probe", Kind: kind, Target: "peer.example"}}
		if err := cfg.Validate(); err == nil {
			t.Fatalf("expected %q probe kind to be rejected", kind)
		}
	}
}

func TestValidateAcceptsTCPProbeWithSafeDefaults(t *testing.T) {
	cfg := baseConfig()
	cfg.Probes = []Probe{{Name: "peer_tcp", Kind: "tcp", Target: "peer.example", Port: 443}}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("TCP probe was rejected: %v", err)
	}
	probe := cfg.Probes[0]
	if probe.Samples != 3 || probe.TimeoutSeconds != 3 || probe.ConnectTimeoutMS != 1000 {
		t.Fatalf("unexpected TCP defaults: %+v", probe)
	}
}

func TestValidateRejectsUnsafeTCPProbe(t *testing.T) {
	for _, probe := range []Probe{
		{Name: "peer_tcp", Kind: "tcp", Target: "peer.example", Port: 0},
		{Name: "peer_tcp", Kind: "tcp", Target: "peer.example:443", Port: 443},
		{Name: "peer_tcp", Kind: "tcp", Target: "peer.example", Port: 443, TimeoutSeconds: 1, Samples: 3, SampleIntervalMS: 250, ConnectTimeoutMS: 1000},
	} {
		cfg := baseConfig()
		cfg.Probes = []Probe{probe}
		if err := cfg.Validate(); err == nil {
			t.Fatalf("expected unsafe TCP probe to be rejected: %+v", probe)
		}
	}
}

func TestValidateRejectsICMPPortAndUnsafeHost(t *testing.T) {
	for _, target := range []string{"peer.example:443", "--help", "peer example"} {
		cfg := baseConfig()
		cfg.Probes = []Probe{{Name: "peer_icmp", Kind: "icmp", Target: target}}
		if err := cfg.Validate(); err == nil {
			t.Fatalf("expected unsafe ICMP target %q to be rejected", target)
		}
	}
}

func TestValidateRejectsImpossibleSampleSchedule(t *testing.T) {
	cfg := baseConfig()
	cfg.Probes = []Probe{{
		Name: "peer_icmp", Kind: "icmp", Target: "peer.example", TimeoutSeconds: 1,
		Samples: 5, SampleIntervalMS: 250,
	}}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected samples that cannot start before the round timeout to be rejected")
	}
}

func TestAccountingConfigurationValidation(t *testing.T) {
	for _, names := range [][]string{{"lo"}, {"eth0", "eth0"}, {"../eth0"}, {"."}, {".."}, {"a very long name"}} {
		cfg := baseConfig()
		cfg.NetworkInterfaces = names
		if cfg.Validate() == nil {
			t.Fatalf("accepted %v", names)
		}
	}
	cfg := baseConfig()
	cfg.NetworkInterfaces = []string{"eth0", "wg0"}
	cfg.TrafficCycle = TrafficCycle{Enabled: true, ResetDay: 31, TimeZone: "Asia/Shanghai"}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	cfg.TrafficCycle.ResetDay = 32
	if cfg.Validate() == nil {
		t.Fatal("accepted invalid reset day")
	}
	cfg.TrafficCycle.ResetDay = 1
	cfg.TrafficCycle.TimeZone = "arbitrary"
	if cfg.Validate() == nil {
		t.Fatal("accepted unsupported timezone")
	}
}
func TestFingerprintAcknowledgesTheExactLoadedFile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Load requires Unix file permissions")
	}
	cfg := baseConfig()
	body, _ := json.MarshalIndent(cfg, "", "  ")
	body = append(body, '\n')
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, body, 0600); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Fingerprint != fmt.Sprintf("%x", sha256.Sum256(body)) {
		t.Fatal("fingerprint does not match loaded bytes")
	}
	os.WriteFile(path, append(body, []byte("{}")...), 0600)
	if _, err := Load(path); err == nil {
		t.Fatal("trailing configuration data was accepted")
	}
}

func TestDecodeUpgradeDiscardsOnlyRetiredFields(t *testing.T) {
	original := baseConfig()
	original.Probes = []Probe{{Name: "reference", Kind: "icmp", Target: "192.0.2.1"}}
	raw, _ := json.Marshal(original)
	var document map[string]any
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	document["nftables_counters"] = []any{map[string]any{"name": "old-rule"}}
	node := document["node"].(map[string]any)
	node["short_mark"] = "OLD"
	raw, _ = json.Marshal(document)
	cfg, err := decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Node.ID != original.Node.ID || cfg.Secret != original.Secret || len(cfg.Probes) != 1 {
		t.Fatal("current configuration changed")
	}
	if cfg.Fingerprint != fmt.Sprintf("%x", sha256.Sum256(raw)) {
		t.Fatal("fingerprint must identify the actual input file")
	}
	clean, _ := json.Marshal(cfg)
	var result map[string]any
	json.Unmarshal(clean, &result)
	if _, found := result["nftables_counters"]; found {
		t.Fatal("retired counters were serialized")
	}
	if _, found := result["node"].(map[string]any)["short_mark"]; found {
		t.Fatal("retired node metadata was serialized")
	}
	for _, scope := range []map[string]any{document, node} {
		scope["unexpected_option"] = true
		invalid, _ := json.Marshal(document)
		if _, err := decode(invalid); err == nil {
			t.Fatal("unrecognized fields must still fail")
		}
		delete(scope, "unexpected_option")
	}
}
