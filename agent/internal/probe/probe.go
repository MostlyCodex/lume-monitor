package probe

import (
	"context"
	"crypto/tls"
	"fmt"
	"math"
	"net"
	"sort"
	"strings"
	"sync"
	"time"

	probing "github.com/prometheus-community/pro-bing"

	"github.com/MostlyCodex/yuanshan-monitor/agent/internal/config"
	"github.com/MostlyCodex/yuanshan-monitor/agent/internal/model"
)

type transportTarget struct {
	dialAddress string
	serverName  string
	remoteIP    string
}

type attemptResult struct {
	success    bool
	durationMS float64
	errorText  string
}

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
	if result.Kind == "icmp" {
		packetLoss := result.SampleFailurePercent
		result.PacketLossPercent = &packetLoss
	}
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

func resolveTransportTarget(parent context.Context, cfg config.Probe) (transportTarget, error) {
	host, port, err := net.SplitHostPort(cfg.Target)
	if err != nil {
		return transportTarget{}, err
	}
	host = strings.Trim(host, "[]")
	address := net.ParseIP(host)
	if address == nil {
		resolved, resolveErr := net.DefaultResolver.LookupIPAddr(parent, host)
		if resolveErr != nil {
			return transportTarget{}, resolveErr
		}
		if len(resolved) == 0 {
			return transportTarget{}, fmt.Errorf("DNS returned no addresses")
		}
		address = resolved[0].IP
	}
	return transportTarget{
		dialAddress: net.JoinHostPort(address.String(), port),
		serverName:  host,
		remoteIP:    address.String(),
	}, nil
}

func transportAttempt(parent context.Context, cfg config.Probe, target transportTarget) attemptResult {
	started := time.Now()
	dialer := &net.Dialer{}
	connection, err := dialer.DialContext(parent, "tcp", target.dialAddress)
	if err != nil {
		return attemptResult{durationMS: float64(time.Since(started).Microseconds()) / 1000, errorText: cleanError(err)}
	}
	defer connection.Close()
	if cfg.Kind == "tls" {
		tlsConnection := tls.Client(connection, &tls.Config{
			MinVersion: tls.VersionTLS12,
			ServerName: target.serverName,
		})
		if deadline, ok := parent.Deadline(); ok {
			_ = tlsConnection.SetDeadline(deadline)
		}
		if err := tlsConnection.HandshakeContext(parent); err != nil {
			return attemptResult{durationMS: float64(time.Since(started).Microseconds()) / 1000, errorText: cleanError(err)}
		}
	}
	return attemptResult{success: true, durationMS: float64(time.Since(started).Microseconds()) / 1000}
}

func runTransport(parent context.Context, cfg config.Probe) model.ProbeResult {
	result := resultMetadata(cfg)
	result.CheckedAt = time.Now().Unix()
	round, cancel := context.WithTimeout(parent, time.Duration(cfg.TimeoutSeconds)*time.Second)
	defer cancel()
	target, err := resolveTransportTarget(round, cfg)
	if err != nil {
		return finishResult(result, nil, 0, cfg.Samples, cleanError(err))
	}
	result.RemoteIP = target.remoteIP

	attempts := make(chan attemptResult, cfg.Samples)
	var wait sync.WaitGroup
	started := 0
	for sample := 0; sample < cfg.Samples; sample++ {
		if sample > 0 {
			timer := time.NewTimer(time.Duration(cfg.SampleIntervalMS) * time.Millisecond)
			select {
			case <-round.Done():
				timer.Stop()
				sample = cfg.Samples
				continue
			case <-timer.C:
			}
		}
		if round.Err() != nil {
			break
		}
		started++
		wait.Add(1)
		go func() {
			defer wait.Done()
			attempts <- transportAttempt(round, cfg, target)
		}()
	}
	wait.Wait()
	close(attempts)

	durations := make([]float64, 0, started)
	lastError := ""
	for attempt := range attempts {
		if attempt.success {
			durations = append(durations, attempt.durationMS)
		} else {
			lastError = attempt.errorText
		}
	}
	if started < cfg.Samples && lastError == "" {
		lastError = cleanError(round.Err())
	}
	return finishResult(result, durations, started, cfg.Samples, lastError)
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

func one(parent context.Context, cfg config.Probe) model.ProbeResult {
	if cfg.Kind == "icmp" {
		return runICMP(parent, cfg)
	}
	return runTransport(parent, cfg)
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
			results[index] = one(parent, cfg)
		}()
	}
	wait.Wait()
	return results
}
