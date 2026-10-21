package probe

import (
	"context"
	"net"
	"sort"
	"strconv"
	"sync"
	"time"


	"github.com/MostlyCodex/lume-monitor/agent/internal/config"
	"github.com/MostlyCodex/lume-monitor/agent/internal/model"
)

func resultMetadata(cfg config.Probe) model.ProbeResult {
	return model.ProbeResult{
		Name: cfg.Name, Label: cfg.Label, Category: cfg.Category, TargetNodeID: cfg.TargetNodeID,
		Kind: cfg.Kind, WarningMS: cfg.WarningMS, CriticalMS: cfg.CriticalMS,
		Severity: cfg.Severity, DisplayOrder: cfg.DisplayOrder,
	}
}

// A round succeeds when it completed and more than half of its samples
// succeeded; the reported latency is the median of the successful samples.
func finishResult(result model.ProbeResult, durations []float64, attempted int, requested int) model.ProbeResult {
	result.Samples = requested
	result.AttemptedSamples = attempted
	result.SuccessfulSamples = len(durations)
	result.Complete = attempted == requested
	result.Success = result.Complete && len(durations) > requested/2
	if count := len(durations); count > 0 {
		sorted := append([]float64(nil), durations...)
		sort.Float64s(sorted)
		result.DurationMS = (sorted[(count-1)/2] + sorted[count/2]) / 2
	}
	return result
}

type tcpSample struct {
	durationMS float64
	attempted  bool
	connected  bool
}

func runTCP(parent context.Context, cfg config.Probe) model.ProbeResult {
	result := resultMetadata(cfg)
	result.CheckedAt = time.Now().Unix()
	round, cancel := context.WithTimeout(parent, time.Duration(cfg.TimeoutSeconds)*time.Second)
	defer cancel()

	samples := make(chan tcpSample, cfg.Samples)
	address := net.JoinHostPort(cfg.Target, strconv.Itoa(cfg.Port))
	for index := 0; index < cfg.Samples; index++ {
		delay := time.Duration(index*cfg.SampleIntervalMS) * time.Millisecond
		go func() {
			timer := time.NewTimer(delay)
			defer timer.Stop()
			select {
			case <-round.Done():
				samples <- tcpSample{}
				return
			case <-timer.C:
			}

			started := time.Now()
			dialer := net.Dialer{Timeout: time.Duration(cfg.ConnectTimeoutMS) * time.Millisecond}
			connection, err := dialer.DialContext(round, "tcp", address)
			if err != nil {
				samples <- tcpSample{attempted: true}
				return
			}
			duration := float64(time.Since(started).Microseconds()) / 1000
			_ = connection.Close()
			samples <- tcpSample{durationMS: duration, attempted: true, connected: true}
		}()
	}

	durations := make([]float64, 0, cfg.Samples)
	attempted := 0
	for index := 0; index < cfg.Samples; index++ {
		sample := <-samples
		if sample.attempted {
			attempted++
		}
		if sample.connected {
			durations = append(durations, sample.durationMS)
		}
	}
	return finishResult(result, durations, attempted, cfg.Samples)
}

func Run(parent context.Context, probes []config.Probe) []model.ProbeResult {
	results := make([]model.ProbeResult, len(probes))
	semaphore := make(chan struct{}, 2)
	var wait sync.WaitGroup
	for index, cfg := range probes {
		wait.Add(1)
		go func() {
			defer wait.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()
			results[index] = runTCP(parent, cfg)
		}()
	}
	wait.Wait()
	return results
}
