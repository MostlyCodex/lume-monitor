package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/MostlyCodex/lume-monitor/agent/internal/check"
	"github.com/MostlyCodex/lume-monitor/agent/internal/collect"
	"github.com/MostlyCodex/lume-monitor/agent/internal/config"
	"github.com/MostlyCodex/lume-monitor/agent/internal/model"
	"github.com/MostlyCodex/lume-monitor/agent/internal/probe"
	"github.com/MostlyCodex/lume-monitor/agent/internal/sender"
	"github.com/MostlyCodex/lume-monitor/agent/internal/spool"
	"github.com/MostlyCodex/lume-monitor/agent/internal/traffic"
)

var version = "dev"

type metricsCollector interface {
	Collect() (model.SystemMetrics, []error)
}

type application struct {
	config      config.Config
	collector   metricsCollector
	sender      *sender.Sender
	startedAt   int64
	lastProbeAt time.Time
	lastProbes  []model.ProbeResult
	traffic     *traffic.Tracker
	clock       func() time.Time
}

func (a *application) runOnce(parent context.Context, dryRun bool) error {
	ctx, cancel := context.WithTimeout(parent, 25*time.Second)
	defer cancel()

	pending, pendingErr := spool.Load(a.config.SpoolPath)
	if pendingErr != nil {
		log.Printf("pending report unreadable: %v", pendingErr)
	} else if len(pending) > 0 && !dryRun {
		if err := a.sender.Send(ctx, pending); err == nil {
			_ = spool.Delete(a.config.SpoolPath)
		}
	}

	sampledAt := time.Now()
	if a.clock != nil {
		sampledAt = a.clock()
	}
	system, collectionErrors := a.collector.Collect()
	for _, collectionErr := range collectionErrors {
		log.Printf("collection error: %v", collectionErr)
	}
	if a.traffic != nil {
		var trafficErr error
		system.TrafficCycle, trafficErr = a.traffic.Observe(sampledAt, a.config.TrafficCycle, system, !dryRun)
		if trafficErr != nil {
			log.Printf("traffic accounting unavailable: %v", trafficErr)
		}
	}
	services := check.Services(ctx, a.config.Services)
	probeInterval := time.Duration(a.config.ProbeIntervalSeconds) * time.Second
	probeSlack := time.Duration(a.config.ReportIntervalSeconds) * time.Second / 10
	if a.lastProbeAt.IsZero() || time.Since(a.lastProbeAt) >= probeInterval-probeSlack {
		a.lastProbeAt = time.Now()
		a.lastProbes = probe.Run(ctx, a.config.Probes)
	}
	report := model.Report{
		SchemaVersion: 2,
		AgentVersion:  version,
		NodeID:        a.config.Node.ID,
		Node: model.NodeMetadata{
			ID:               a.config.Node.ID,
			DisplayName:      a.config.Node.DisplayName,
			Role:             a.config.Node.Role,
			Region:           a.config.Node.Region,
			StaleSeconds:     a.config.Node.StaleSeconds,
			DisplayOrder:     a.config.Node.DisplayOrder,
			IPChangeSeverity: a.config.Node.IPChangeSeverity,
		},
		GeneratedAt: sampledAt.Unix(),
		System:      system,
		Services:    services,
		Probes:      a.lastProbes,
		Agent: model.AgentHealth{
			ConfigFingerprint: a.config.Fingerprint,
			StartedAt:         a.startedAt,
		},
	}
	body, err := json.Marshal(report)
	if err != nil {
		return fmt.Errorf("encode report: %w", err)
	}
	if dryRun {
		var pretty any
		_ = json.Unmarshal(body, &pretty)
		output, _ := json.MarshalIndent(pretty, "", "  ")
		fmt.Println(string(output))
		return nil
	}
	if err := a.sender.Send(ctx, body); err != nil {
		if spoolErr := spool.Save(a.config.SpoolPath, body); spoolErr != nil {
			return fmt.Errorf("%w; save pending report: %v", err, spoolErr)
		}
		return err
	}
	if err := spool.Delete(a.config.SpoolPath); err != nil {
		log.Printf("delete pending report: %v", err)
	}
	return nil
}

func main() {
	configPath := flag.String("config", "/etc/vpsmon/config.json", "path to configuration file")
	once := flag.Bool("once", false, "collect and send one report, then exit")
	dryRun := flag.Bool("dry-run", false, "collect one report and print it without sending")
	listServices := flag.Bool("list-services", false, "print configured systemd service names and exit")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}
	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("configuration rejected: %v", err)
	}
	if *listServices {
		for _, service := range cfg.Services {
			fmt.Println(service.Name)
		}
		return
	}
	app := &application{
		config:    cfg,
		collector: collect.New(cfg.NetworkInterfaces...),
		traffic:   traffic.New("/var/lib/vpsmon/traffic.json"),
		sender:    sender.New(cfg.Endpoint, cfg.Node.ID, cfg.Secret, version),
		startedAt: time.Now().Unix(),
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := app.runOnce(ctx, *dryRun); err != nil && !*dryRun {
		log.Printf("initial report failed: %v", err)
		if *once {
			os.Exit(1)
		}
	}
	if *once || *dryRun {
		return
	}

	ticker := time.NewTicker(time.Duration(cfg.ReportIntervalSeconds) * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := app.runOnce(ctx, false); err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("report failed: %v", err)
			}
		}
	}
}
