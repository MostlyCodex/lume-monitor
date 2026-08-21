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
	"sync/atomic"
	"syscall"
	"time"

	"github.com/MostlyCodex/yuanshan-monitor/agent/internal/check"
	"github.com/MostlyCodex/yuanshan-monitor/agent/internal/collect"
	"github.com/MostlyCodex/yuanshan-monitor/agent/internal/config"
	"github.com/MostlyCodex/yuanshan-monitor/agent/internal/model"
	"github.com/MostlyCodex/yuanshan-monitor/agent/internal/probe"
	"github.com/MostlyCodex/yuanshan-monitor/agent/internal/sender"
	"github.com/MostlyCodex/yuanshan-monitor/agent/internal/spool"
)

var version = "dev"

type application struct {
	config        config.Config
	collector     *collect.Collector
	sender        *sender.Sender
	startedAt     int64
	collectErrors atomic.Uint64
	sendErrors    atomic.Uint64
	lastProbeAt   time.Time
	lastProbes    []model.ProbeResult
}

func (a *application) runOnce(parent context.Context, dryRun bool) error {
	ctx, cancel := context.WithTimeout(parent, 25*time.Second)
	defer cancel()

	pending, pendingErr := spool.Load(a.config.SpoolPath)
	queueDepth := 0
	if pendingErr != nil {
		a.collectErrors.Add(1)
	} else if len(pending) > 0 {
		queueDepth = 1
		if !dryRun {
			if err := a.sender.Send(ctx, pending); err == nil {
				_ = spool.Delete(a.config.SpoolPath)
				queueDepth = 0
			} else {
				a.sendErrors.Add(1)
			}
		}
	}

	system, collectionErrors := a.collector.Collect()
	a.collectErrors.Add(uint64(len(collectionErrors)))
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
			ShortMark:        a.config.Node.ShortMark,
			Role:             a.config.Node.Role,
			Group:            a.config.Node.Group,
			Region:           a.config.Node.Region,
			StaleSeconds:     a.config.Node.StaleSeconds,
			DisplayOrder:     a.config.Node.DisplayOrder,
			Color:            a.config.Node.Color,
			OfflineSeverity:  a.config.Node.OfflineSeverity,
			IPChangeSeverity: a.config.Node.IPChangeSeverity,
		},
		GeneratedAt: time.Now().Unix(),
		System:      system,
		Services:    services,
		Probes:      a.lastProbes,
		Agent: model.AgentHealth{
			QueueDepth:    queueDepth,
			CollectErrors: a.collectErrors.Load(),
			SendErrors:    a.sendErrors.Load(),
			StartedAt:     a.startedAt,
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
		a.sendErrors.Add(1)
		if spoolErr := spool.Save(a.config.SpoolPath, body); spoolErr != nil {
			return fmt.Errorf("%w; save pending report: %v", err, spoolErr)
		}
		return err
	}
	if err := spool.Delete(a.config.SpoolPath); err != nil {
		a.collectErrors.Add(1)
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
		collector: collect.New(),
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
