package probe

import (
	"context"
	"math"
	"net"
	"testing"
	"time"

	"github.com/MostlyCodex/yuanshan-monitor/agent/internal/config"
	"github.com/MostlyCodex/yuanshan-monitor/agent/internal/model"
)

func TestTCPProbeSucceedsAgainstLocalListener(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		for i := 0; i < 5; i++ {
			connection, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			_ = connection.Close()
		}
	}()
	results := Run(context.Background(), []config.Probe{{
		Name: "local_tcp", Label: "Local TCP", Category: "node-link", TargetNodeID: "peer-vps",
		Kind: "tcp", Target: listener.Addr().String(), TimeoutSeconds: 2, Samples: 5,
		SampleIntervalMS: 100, Severity: "P1",
	}})
	if len(results) != 1 || !results[0].Success || !results[0].Complete || results[0].Samples != 5 ||
		results[0].AttemptedSamples != 5 || results[0].SuccessfulSamples != 5 || results[0].SampleFailurePercent != 0 {
		t.Fatalf("unexpected result: %+v", results)
	}
	if results[0].Label != "Local TCP" || results[0].Category != "node-link" || results[0].TargetNodeID != "peer-vps" {
		t.Fatalf("probe metadata was not preserved: %+v", results[0])
	}
}

func TestTCPProbeHonorsFailure(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	results := Run(ctx, []config.Probe{{
		Name: "closed", Kind: "tcp", Target: "127.0.0.1:1", TimeoutSeconds: 1,
		Samples: 1, SampleIntervalMS: 100,
	}})
	if results[0].Success || results[0].Error == "" {
		t.Fatalf("expected bounded failure, got %+v", results[0])
	}
}

func TestFinishResultUsesMedianP95AndStandardDeviation(t *testing.T) {
	result := finishResult(modelResult("tcp"), []float64{10, 20, 30, 40, 100}, 5, 5, "")
	if result.DurationMS != 30 || result.AverageDurationMS != 40 || result.P95DurationMS != 88 ||
		result.RangeMS != 90 || math.Abs(result.JitterMS-31.62277660) > 0.0001 {
		t.Fatalf("unexpected statistics: %+v", result)
	}
}

func TestFinishResultDistinguishesICMPPacketLoss(t *testing.T) {
	result := finishResult(modelResult("icmp"), []float64{10, 12, 11, 13}, 5, 5, "timeout")
	if result.PacketLossPercent == nil || *result.PacketLossPercent != 20 || result.SampleFailurePercent != 20 {
		t.Fatalf("unexpected ICMP loss statistics: %+v", result)
	}
	transport := finishResult(modelResult("tcp"), []float64{10, 12, 11, 13}, 5, 5, "timeout")
	if transport.PacketLossPercent != nil {
		t.Fatalf("transport failures must not be labeled packet loss: %+v", transport)
	}
}

func modelResult(kind string) model.ProbeResult {
	return model.ProbeResult{Kind: kind}
}
