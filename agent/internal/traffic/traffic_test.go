package traffic

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/MostlyCodex/lume-monitor/agent/internal/config"
	"github.com/MostlyCodex/lume-monitor/agent/internal/model"
)

func at(value string) time.Time {
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		panic(err)
	}
	return t
}
func metrics(boot string, rx, tx uint64) model.SystemMetrics {
	return model.SystemMetrics{BootID: boot, NetworkValid: true, NetworkInterfaces: []string{"eth0"}, NetworkCounters: map[string]model.InterfaceCounters{"eth0": {RX: rx, TX: tx, Index: 2}}}
}
func TestPeriodUsesTimezoneAndClampsMissingDays(t *testing.T) {
	for _, tc := range []struct {
		now              string
		day              int
		zone, start, end string
	}{
		{"2026-02-28T01:00:00Z", 31, "UTC", "2026-02-28T00:00:00Z", "2026-03-31T00:00:00Z"},
		{"2028-02-29T01:00:00Z", 31, "UTC", "2028-02-29T00:00:00Z", "2028-03-31T00:00:00Z"},
		{"2026-02-01T00:00:00Z", 31, "UTC", "2026-01-31T00:00:00Z", "2026-02-28T00:00:00Z"},
		{"2026-08-31T16:01:00Z", 1, "Asia/Shanghai", "2026-08-31T16:00:00Z", "2026-09-30T16:00:00Z"},
	} {
		start, end := Period(at(tc.now), tc.day, tc.zone)
		if !start.Equal(at(tc.start)) || !end.Equal(at(tc.end)) {
			t.Fatalf("%+v: %s %s", tc, start, end)
		}
	}
}
func TestTrafficPersistsAcrossAgentRestartAndCounterResets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "traffic.json")
	cfg := config.TrafficCycle{Enabled: true, ResetDay: 1, TimeZone: "UTC"}
	now := at("2026-09-10T12:00:00Z")
	observe := func(tracker *Tracker, step int, system model.SystemMetrics) *model.TrafficCycle {
		t.Helper()
		cycle, err := tracker.Observe(now.Add(time.Duration(step)*time.Minute), cfg, system, true)
		if err != nil {
			t.Fatal(err)
		}
		return cycle
	}
	first := observe(New(path), 0, metrics("a", 1000, 2000))
	if first.RXBytes != 0 || !first.Partial {
		t.Fatal(first)
	}
	second := observe(New(path), 1, metrics("a", 1200, 2300))
	if second.RXBytes != 200 || second.TXBytes != 300 {
		t.Fatal(second)
	}
	reboot := observe(New(path), 2, metrics("b", 10, 20))
	if reboot.RXBytes != 200 || reboot.TXBytes != 300 {
		t.Fatal(reboot)
	}
	next := observe(New(path), 3, metrics("b", 110, 220))
	if next.RXBytes != 300 || next.TXBytes != 500 {
		t.Fatal(next)
	}
	reset := observe(New(path), 4, metrics("b", 1, 2))
	if reset.RXBytes != 300 || reset.TXBytes != 500 {
		t.Fatal(reset)
	}
	recreated := metrics("b", 9999, 9999)
	recreated.NetworkCounters["eth0"] = model.InterfaceCounters{RX: 9999, TX: 9999, Index: 3}
	last := observe(New(path), 5, recreated)
	if last.RXBytes != 300 {
		t.Fatal(last)
	}
}
func TestCycleBoundaryAndChangedPolicyDoNotChargeEarlierTraffic(t *testing.T) {
	path := filepath.Join(t.TempDir(), "traffic.json")
	tracker := New(path)
	cfg := config.TrafficCycle{Enabled: true, ResetDay: 1, TimeZone: "UTC"}
	tracker.Observe(at("2026-09-30T23:59:00Z"), cfg, metrics("a", 100, 200), true)
	cycle, err := tracker.Observe(at("2026-10-01T00:01:00Z"), cfg, metrics("a", 500, 900), true)
	if err != nil || cycle.RXBytes != 0 || !cycle.Partial {
		t.Fatalf("%+v %v", cycle, err)
	}
	cycle, err = tracker.Observe(at("2026-10-01T00:02:00Z"), cfg, metrics("a", 600, 1000), true)
	if err != nil || cycle.RXBytes != 100 {
		t.Fatalf("%+v %v", cycle, err)
	}
	cfg.Enabled = false
	if _, err = tracker.Observe(at("2026-10-01T00:03:00Z"), cfg, metrics("a", 700, 1100), true); err != nil {
		t.Fatal(err)
	}
	cfg.Enabled = true
	cycle, err = tracker.Observe(at("2026-10-01T00:04:00Z"), cfg, metrics("a", 900, 1300), true)
	if err != nil || cycle.RXBytes != 0 {
		t.Fatalf("opt-in charged disabled time: %+v %v", cycle, err)
	}
	changed := metrics("a", 5000, 8000)
	changed.NetworkInterfaces = []string{"eth1"}
	changed.NetworkCounters = map[string]model.InterfaceCounters{"eth1": {RX: 5000, TX: 8000, Index: 4}}
	cycle, err = tracker.Observe(at("2026-10-01T00:05:00Z"), cfg, changed, true)
	if err != nil || cycle.RXBytes != 0 {
		t.Fatalf("interface switch mixed scopes: %+v %v", cycle, err)
	}
}
func TestClockRollbackDryRunAndCorruptionPreserveState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "traffic.json")
	tracker := New(path)
	cfg := config.TrafficCycle{Enabled: true, ResetDay: 1, TimeZone: "UTC"}
	tracker.Observe(at("2026-10-01T00:01:00Z"), cfg, metrics("a", 100, 200), true)
	before, _ := os.ReadFile(path)
	if _, err := tracker.Observe(at("2026-09-30T23:59:00Z"), cfg, metrics("a", 200, 300), true); err == nil {
		t.Fatal("clock rollback was accepted")
	}
	tracker.Observe(at("2026-10-01T00:02:00Z"), cfg, metrics("a", 200, 300), false)
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatal("read-only observation or clock rollback overwrote state")
	}
	os.WriteFile(path, []byte("corrupt"), 0600)
	if _, err := tracker.Observe(at("2026-10-01T00:03:00Z"), cfg, metrics("a", 300, 400), true); err == nil {
		t.Fatal("corruption silently reset billing totals")
	}
}
