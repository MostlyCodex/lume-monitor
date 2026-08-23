package probe

import (
	"math"
	"testing"

	"github.com/MostlyCodex/yuanshan-monitor/agent/internal/model"
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

func modelResult() model.ProbeResult {
	return model.ProbeResult{Kind: "icmp"}
}
