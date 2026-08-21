package config

import "testing"

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
	cfg.Probes = []Probe{{Name: "peer_tls", Kind: "tls", Target: "peer.example:443"}}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	if cfg.ReportIntervalSeconds != 60 || cfg.ProbeIntervalSeconds != 60 || cfg.Probes[0].TimeoutSeconds != 4 ||
		cfg.Probes[0].Samples != 1 || cfg.Probes[0].SampleIntervalMS != 250 {
		t.Fatalf("safe defaults not applied: %+v", cfg)
	}
	if cfg.Node.DisplayName != "future-vps-01" || cfg.Node.Role != "VPS" || cfg.Node.OfflineSeverity != "P1" {
		t.Fatalf("node defaults not applied: %+v", cfg.Node)
	}
	if cfg.Services[0].Label != "example.service" || cfg.Services[0].Severity != "P1" {
		t.Fatalf("service defaults not applied: %+v", cfg.Services[0])
	}
	if cfg.Probes[0].Label != "peer_tls" || cfg.Probes[0].Category != "custom" || cfg.Probes[0].Severity != "P2" {
		t.Fatalf("probe defaults not applied: %+v", cfg.Probes[0])
	}
}

func TestValidateAppliesICMPDefaults(t *testing.T) {
	cfg := baseConfig()
	cfg.Probes = []Probe{{Name: "peer_icmp", Kind: "icmp", Target: "peer.example"}}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	if cfg.Probes[0].Samples != 5 || cfg.Probes[0].SampleIntervalMS != 250 {
		t.Fatalf("ICMP defaults not applied: %+v", cfg.Probes[0])
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
		Name: "peer_tcp", Kind: "tcp", Target: "peer.example:443", WarningMS: 50, CriticalMS: 20,
	}}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected inverted latency thresholds to be rejected")
	}
}

func TestValidateRequiresTargetNodeForNodeLink(t *testing.T) {
	cfg := baseConfig()
	cfg.Probes = []Probe{{
		Name: "peer_tcp", Category: "node-link", Kind: "tcp", Target: "peer.example:443",
	}}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected node-link without target_node_id to be rejected")
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
		Name: "peer_tcp", Kind: "tcp", Target: "peer.example:443", TimeoutSeconds: 1,
		Samples: 5, SampleIntervalMS: 250,
	}}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected samples that cannot start before the round timeout to be rejected")
	}
}
