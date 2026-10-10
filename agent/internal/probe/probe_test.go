package probe

import (
	"net"
	"strconv"
	"testing"
	"time"

	"github.com/MostlyCodex/lume-monitor/agent/internal/config"
	"github.com/MostlyCodex/lume-monitor/agent/internal/model"
)

func TestFinishResultUsesMedianLatency(t *testing.T) {
	result := finishResult(model.ProbeResult{Kind: "icmp"}, []float64{10, 20, 30, 40, 100}, 5, 5)
	if result.DurationMS != 30 || !result.Success || !result.Complete {
		t.Fatalf("unexpected odd-count result: %+v", result)
	}
	result = finishResult(model.ProbeResult{Kind: "icmp"}, []float64{40, 10, 30, 20}, 5, 5)
	if result.DurationMS != 25 {
		t.Fatalf("unexpected even-count median: %+v", result)
	}
}

func TestFinishResultCountsSamplesForLossAndSuccess(t *testing.T) {
	result := finishResult(model.ProbeResult{Kind: "icmp"}, []float64{10, 12, 11, 13}, 5, 5)
	if result.Samples != 5 || result.AttemptedSamples != 5 || result.SuccessfulSamples != 4 || !result.Success {
		t.Fatalf("unexpected sample counts: %+v", result)
	}
	if result = finishResult(model.ProbeResult{Kind: "tcp"}, []float64{2}, 3, 3); result.Success {
		t.Fatalf("a TCP round with one of three connections must fail: %+v", result)
	}
	if result = finishResult(model.ProbeResult{Kind: "icmp"}, []float64{2, 3, 4}, 2, 5); result.Complete || result.Success {
		t.Fatalf("an interrupted round must be incomplete and failed: %+v", result)
	}
}

func TestRunTCPMeasuresLocalListener(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		for index := 0; index < 3; index++ {
			connection, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			_ = connection.Close()
		}
	}()
	port := listener.Addr().(*net.TCPAddr).Port
	result := runTCP(t.Context(), config.Probe{
		Name: "local_tcp", Label: "Local TCP", Kind: "tcp", Target: "127.0.0.1", Port: port,
		TimeoutSeconds: 2, ConnectTimeoutMS: 500, Samples: 3, SampleIntervalMS: 100,
	})
	if !result.Success || result.SuccessfulSamples != 3 || result.DurationMS < 0 {
		t.Fatalf("unexpected local TCP result on port %s: %+v", strconv.Itoa(port), result)
	}
	if time.Since(time.Unix(result.CheckedAt, 0)) > 2*time.Second {
		t.Fatalf("checked_at is stale: %+v", result)
	}
}
