package probe

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	probing "github.com/prometheus-community/pro-bing"

	"github.com/MostlyCodex/yuanshan-monitor/agent/internal/config"
	"github.com/MostlyCodex/yuanshan-monitor/agent/internal/model"
)

func cleanError(err error) string {
	if err == nil {
		return ""
	}
	value := strings.Join(strings.Fields(err.Error()), " ")
	if len(value) > 160 {
		value = value[:160]
	}
	return value
}

func resultMetadata(cfg config.Probe) model.ProbeResult {
	return model.ProbeResult{
		Name: cfg.Name, Label: cfg.Label, Category: cfg.Category, TargetNodeID: cfg.TargetNodeID,
		Kind: cfg.Kind, Target: cfg.Target, WarningMS: cfg.WarningMS, CriticalMS: cfg.CriticalMS,
		WarningFailurePercent: cfg.WarningFailurePercent, CriticalFailurePercent: cfg.CriticalFailurePercent,
		Severity: cfg.Severity, DisplayOrder: cfg.DisplayOrder, Primary: cfg.Primary,
	}
}

func percentile(sorted []float64, fraction float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	position := math.Max(0, math.Min(1, fraction)) * float64(len(sorted)-1)
	lower := int(math.Floor(position))
	upper := int(math.Ceil(position))
	if lower == upper {
		return sorted[lower]
	}
	weight := position - float64(lower)
	return sorted[lower]*(1-weight) + sorted[upper]*weight
}

func finishResult(
	result model.ProbeResult,
	durations []float64,
	attempted int,
	requested int,
	lastError string,
) model.ProbeResult {
	result.Samples = requested
	result.AttemptedSamples = attempted
	result.SuccessfulSamples = len(durations)
	result.Complete = attempted == requested
	if attempted > 0 {
		result.SampleFailurePercent = 100 * float64(attempted-len(durations)) / float64(attempted)
	} else {
		result.SampleFailurePercent = 100
	}
	packetLoss := result.SampleFailurePercent
	result.PacketLossPercent = &packetLoss
	result.Success = result.Complete && len(durations) > requested/2

	if len(durations) > 0 {
		sorted := append([]float64(nil), durations...)
		sort.Float64s(sorted)
		total := 0.0
		for _, duration := range sorted {
			total += duration
		}
		average := total / float64(len(sorted))
		variance := 0.0
		for _, duration := range sorted {
			delta := duration - average
			variance += delta * delta
		}
		result.DurationMS = percentile(sorted, 0.50)
		result.AverageDurationMS = average
		result.P95DurationMS = percentile(sorted, 0.95)
		result.MinDurationMS = sorted[0]
		result.MaxDurationMS = sorted[len(sorted)-1]
		result.RangeMS = result.MaxDurationMS - result.MinDurationMS
		result.JitterMS = math.Sqrt(variance / float64(len(sorted)))
	}

	if !result.Success {
		if lastError == "" {
			lastError = "insufficient successful samples"
		}
		result.Error = cleanError(fmt.Errorf(
			"%d/%d samples succeeded (%d/%d attempted): %s",
			len(durations), requested, attempted, requested, lastError,
		))
	}
	return result
}

func runICMP(parent context.Context, cfg config.Probe) model.ProbeResult {
	result := resultMetadata(cfg)
	result.CheckedAt = time.Now().Unix()
	pinger, err := probing.NewPinger(cfg.Target)
	if err != nil {
		return finishResult(result, nil, 0, cfg.Samples, cleanError(err))
	}
	// UDP ping sockets keep the Agent unprivileged. Never switch this to raw
	// ICMP without an explicit security review of the service capabilities.
	pinger.SetPrivileged(false)
	pinger.Count = cfg.Samples
	pinger.Interval = time.Duration(cfg.SampleIntervalMS) * time.Millisecond
	pinger.Timeout = time.Duration(cfg.TimeoutSeconds) * time.Second
	pinger.ResolveTimeout = time.Duration(cfg.TimeoutSeconds) * time.Second
	pinger.RecordRtts = true

	round, cancel := context.WithTimeout(parent, pinger.Timeout+time.Second)
	defer cancel()
	runErr := pinger.RunWithContext(round)
	stats := pinger.Statistics()
	durations := make([]float64, 0, len(stats.Rtts))
	for _, duration := range stats.Rtts {
		durations = append(durations, float64(duration.Microseconds())/1000)
	}
	if stats.IPAddr != nil {
		result.RemoteIP = stats.IPAddr.IP.String()
	}
	lastError := cleanError(runErr)
	if stats.PacketsRecv == 0 && lastError == "" {
		lastError = "no ICMP echo replies; target may block ICMP"
	}
	return finishResult(result, durations, stats.PacketsSent, cfg.Samples, lastError)
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
			results[index] = runICMP(parent, cfg)
		}()
	}
	wait.Wait()
	return results
}
