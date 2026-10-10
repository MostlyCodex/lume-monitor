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

func observe(t *testing.T, path string, now time.Time, cfg config.TrafficCycle, system model.SystemMetrics) *model.TrafficCycle {
	t.Helper()
	cycle, err := New(path).Observe(now, cfg, system, true)
	if err != nil {
		t.Fatal(err)
	}
	return cycle
}

func TestPeriodStartUsesTimezoneAndClampsMissingDays(t *testing.T) {
	for _, tc := range []struct {
		now, zone, start string
		day              int
	}{
		{"2026-02-28T01:00:00Z", "UTC", "2026-02-28T00:00:00Z", 31},
		{"2028-02-29T01:00:00Z", "UTC", "2028-02-29T00:00:00Z", 31},
		{"2026-02-01T00:00:00Z", "UTC", "2026-01-31T00:00:00Z", 31},
		{"2026-08-31T16:01:00Z", "Asia/Shanghai", "2026-08-31T16:00:00Z", 1},
	} {
		if start := PeriodStart(at(tc.now), tc.day, tc.zone); !start.Equal(at(tc.start)) {
			t.Fatalf("%+v: %s", tc, start)
		}
	}
}

func TestTrafficPersistsAcrossAgentRestartAndCounterResets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "traffic.json")
	cfg := config.TrafficCycle{ResetDay: 1, TimeZone: "UTC"}
	now := at("2026-09-10T12:00:00Z")
	step := func(minutes int, system model.SystemMetrics) *model.TrafficCycle {
		return observe(t, path, now.Add(time.Duration(minutes)*time.Minute), cfg, system)
	}
	if first := step(0, metrics("a", 1000, 2000)); first.RXBytes != 0 || first.TXBytes != 0 {
		t.Fatal(first)
	}
	if second := step(1, metrics("a", 1200, 2300)); second.RXBytes != 200 || second.TXBytes != 300 {
		t.Fatal(second)
	}
	if reboot := step(2, metrics("b", 10, 20)); reboot.RXBytes != 200 || reboot.TXBytes != 300 {
		t.Fatal(reboot)
	}
	if next := step(3, metrics("b", 110, 220)); next.RXBytes != 300 || next.TXBytes != 500 {
		t.Fatal(next)
	}
	if reset := step(4, metrics("b", 1, 2)); reset.RXBytes != 300 || reset.TXBytes != 500 {
		t.Fatal(reset)
	}
	recreated := metrics("b", 9999, 9999)
	recreated.NetworkCounters["eth0"] = model.InterfaceCounters{RX: 9999, TX: 9999, Index: 3}
	if last := step(5, recreated); last.RXBytes != 300 {
		t.Fatal(last)
	}
	later := metrics("b", 10999, 10999)
	later.NetworkCounters["eth0"] = model.InterfaceCounters{RX: 10999, TX: 10999, Index: 3}
	if paused := step(60*24*5, later); paused.RXBytes != 1300 {
		t.Fatalf("a pause within the period lost counter growth: %+v", paused)
	}
}

func TestNewPeriodAndChangedSettingsStartFromZero(t *testing.T) {
	path := filepath.Join(t.TempDir(), "traffic.json")
	cfg := config.TrafficCycle{ResetDay: 1, TimeZone: "UTC"}
	observe(t, path, at("2026-09-30T23:58:00Z"), cfg, metrics("a", 100, 200))
	if cycle := observe(t, path, at("2026-09-30T23:59:00Z"), cfg, metrics("a", 300, 400)); cycle.RXBytes != 200 {
		t.Fatal(cycle)
	}
	if cycle := observe(t, path, at("2026-10-01T00:01:00Z"), cfg, metrics("a", 500, 900)); cycle.RXBytes != 0 || cycle.TXBytes != 0 {
		t.Fatalf("a new period carried old traffic: %+v", cycle)
	}
	if cycle := observe(t, path, at("2026-10-01T00:02:00Z"), cfg, metrics("a", 600, 1000)); cycle.RXBytes != 100 {
		t.Fatal(cycle)
	}
	cfg.TimeZone = "Asia/Shanghai"
	if cycle := observe(t, path, at("2026-10-01T00:03:00Z"), cfg, metrics("a", 700, 1100)); cycle.RXBytes != 0 {
		t.Fatalf("a changed time zone kept old totals: %+v", cycle)
	}
	changed := metrics("a", 5000, 8000)
	changed.NetworkInterfaces = []string{"eth1"}
	changed.NetworkCounters = map[string]model.InterfaceCounters{"eth1": {RX: 5000, TX: 8000, Index: 4}}
	observe(t, path, at("2026-10-01T00:04:00Z"), cfg, metrics("a", 800, 1200))
	if cycle := observe(t, path, at("2026-10-01T00:05:00Z"), cfg, changed); cycle.RXBytes != 0 {
		t.Fatalf("an interface switch mixed scopes: %+v", cycle)
	}
}

func TestClockRollbackDryRunAndUnreadableState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "traffic.json")
	cfg := config.TrafficCycle{ResetDay: 1, TimeZone: "UTC"}
	observe(t, path, at("2026-10-01T00:00:00Z"), cfg, metrics("a", 100, 200))
	observe(t, path, at("2026-10-01T00:01:00Z"), cfg, metrics("a", 150, 250))
	before, _ := os.ReadFile(path)
	if cycle := observe(t, path, at("2026-09-30T23:59:00Z"), cfg, metrics("a", 200, 300)); cycle.RXBytes != 50 {
		t.Fatalf("clock rollback changed totals: %+v", cycle)
	}
	if _, err := New(path).Observe(at("2026-10-01T00:02:00Z"), cfg, metrics("a", 200, 300), false); err != nil {
		t.Fatal(err)
	}
	if after, _ := os.ReadFile(path); string(before) != string(after) {
		t.Fatal("clock rollback or dry run overwrote state")
	}
	if err := os.WriteFile(path, []byte("corrupt"), 0o600); err != nil {
		t.Fatal(err)
	}
	if cycle := observe(t, path, at("2026-10-01T00:03:00Z"), cfg, metrics("a", 300, 400)); cycle.RXBytes != 0 {
		t.Fatalf("unreadable state did not restart counting: %+v", cycle)
	}
	if cycle := observe(t, path, at("2026-10-01T00:04:00Z"), cfg, metrics("a", 350, 450)); cycle.RXBytes != 50 {
		t.Fatalf("counting did not resume after restarting: %+v", cycle)
	}
}

func TestInvalidNetworkReportsNoCycle(t *testing.T) {
	system := metrics("a", 1, 2)
	system.NetworkValid = false
	cycle, err := New(filepath.Join(t.TempDir(), "traffic.json")).Observe(at("2026-10-01T00:00:00Z"), config.TrafficCycle{ResetDay: 1, TimeZone: "UTC"}, system, true)
	if err != nil || cycle != nil {
		t.Fatalf("%+v %v", cycle, err)
	}
}
