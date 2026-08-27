package probe

import (
	"math"
	"net"
	"strconv"
	"testing"
	"time"

	"github.com/MostlyCodex/lume-monitor/agent/internal/config"
	"github.com/MostlyCodex/lume-monitor/agent/internal/model"
)

func TestFinishResultUsesMedianP95AndStandardDeviation(t *testing.T) {
	result := finishResult(modelResult(), []float64{10, 20, 30, 40, 100}, 5, 5, "")
	if result.DurationMS != 30 || result.AverageDurationMS != 40 || result.P95DurationMS != 88 ||
		result.RangeMS != 90 || math.Abs(result.JitterMS-31.62277660) > 0.0001 {
		t.Fatalf("unexpected statistics: %+v", result)
	}
}

func TestFinishResultReportsICMPPacketLoss(t *testing.T) {
	result := finishResult(modelResult(), []float64{10, 12, 11, 13}, 5, 5, "timeout")
	if result.PacketLossPercent == nil || *result.PacketLossPercent != 20 || result.SampleFailurePercent != 20 {
		t.Fatalf("unexpected ICMP loss statistics: %+v", result)
	}
}

func TestFinishResultKeepsTCPFailureSeparateFromPacketLoss(t *testing.T) {
	result := finishResult(model.ProbeResult{Kind: "tcp"}, []float64{2, 3}, 3, 3, "timeout")
	if result.PacketLossPercent != nil || result.SampleFailurePercent != 100.0/3.0 {
		t.Fatalf("unexpected TCP failure semantics: %+v", result)
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
	if !result.Success || result.SuccessfulSamples != 3 || result.PacketLossPercent != nil || result.DurationMS < 0 {
		t.Fatalf("unexpected local TCP result on port %s: %+v", strconv.Itoa(port), result)
	}
	if time.Since(time.Unix(result.CheckedAt, 0)) > 2*time.Second {
		t.Fatalf("checked_at is stale: %+v", result)
	}
}

func modelResult() model.ProbeResult {
	return model.ProbeResult{Kind: "icmp"}
}
