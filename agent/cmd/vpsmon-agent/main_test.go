package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/MostlyCodex/lume-monitor/agent/internal/config"
	"github.com/MostlyCodex/lume-monitor/agent/internal/model"
	"github.com/MostlyCodex/lume-monitor/agent/internal/sender"
	"github.com/MostlyCodex/lume-monitor/agent/internal/spool"
	"github.com/MostlyCodex/lume-monitor/agent/internal/traffic"
)

type testCollector struct{ rx uint64 }

func (c *testCollector) Collect() (model.SystemMetrics, []error) {
	return model.SystemMetrics{BootID: "same", NetworkValid: true, NetworkInterfaces: []string{"eth0"}, NetworkRXBytes: c.rx, NetworkCounters: map[string]model.InterfaceCounters{"eth0": {RX: c.rx, TX: 2 * c.rx, Index: 2}}}, nil
}

func TestReportFailureKeepsLatestAndPreservesLocalTraffic(t *testing.T) {
	online := false
	var attempted, accepted []uint64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var report model.Report
		if err := json.NewDecoder(r.Body).Decode(&report); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		attempted = append(attempted, report.System.NetworkRXBytes)
		if !online {
			w.WriteHeader(500)
			return
		}
		accepted = append(accepted, report.System.NetworkRXBytes)
		w.WriteHeader(202)
	}))
	defer server.Close()
	folder := t.TempDir()
	collector := &testCollector{}
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	cfg := config.Config{Node: config.Node{ID: "test-node"}, SpoolPath: filepath.Join(folder, "pending.json"), ReportIntervalSeconds: 60, ProbeIntervalSeconds: 60, TrafficCycle: config.TrafficCycle{Enabled: true, ResetDay: 1, TimeZone: "UTC"}}
	app := &application{config: cfg, collector: collector, sender: sender.New(server.URL, "test-node", "test-secret", "test"), traffic: traffic.New(filepath.Join(folder, "traffic.json"), time.Minute), clock: func() time.Time { return now }}
	for i := 1; i <= 3; i++ {
		collector.rx = uint64(100 * i)
		online = i == 3
		err := app.runOnce(context.Background(), false)
		if (err != nil) == online {
			t.Fatalf("round %d: %v", i, err)
		}
		if !online {
			raw, err := spool.Load(cfg.SpoolPath)
			if err != nil {
				t.Fatal(err)
			}
			var pending model.Report
			if err = json.Unmarshal(raw, &pending); err != nil {
				t.Fatal(err)
			}
			if pending.System.NetworkRXBytes != collector.rx {
				t.Fatal("pending report was not replaced")
			}
			cycle := pending.System.TrafficCycle
			if cycle == nil || cycle.Partial || cycle.RXBytes != uint64((i-1)*100) {
				t.Fatalf("network failure changed local accounting: %+v", cycle)
			}
		}
		now = now.Add(time.Minute)
	}
	if _, err := os.Stat(cfg.SpoolPath); !os.IsNotExist(err) {
		t.Fatalf("pending slot not cleared: %v", err)
	}
	if !reflect.DeepEqual(attempted, []uint64{100, 100, 200, 200, 300}) || !reflect.DeepEqual(accepted, []uint64{200, 300}) {
		t.Fatalf("attempted=%v accepted=%v", attempted, accepted)
	}
}
