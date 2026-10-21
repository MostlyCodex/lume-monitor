import { aggregateMetricEnergy, latencyTone, lossTone, windowLoss } from "../frontend/src/domain/probes";
import { describe, expect, it } from "vitest";

function fleetHistory(rows) {
  const serverTime = 1_000_000;
  return {
    server_time: serverTime,
    probes: rows.map((row, index) => ({
      node_id: "source-node",
      probe_name: "carrier",
      // All rows fall inside the last one-hour cell.
      timestamp: serverTime - 1_500 + index * 300,
      rounds: 1,
      ...row,
    })),
  };
}

const probe = { name: "carrier", kind: "tcp", samples: 5 };

describe("fixed color scales", () => {
  it("grades latency as green under 80 ms, blue under 160, yellow under 240, red above", () => {
    expect([0, 79.9, 80, 159.9, 160, 239.9, 240].map(latencyTone)).toEqual([
      "green", "green", "blue", "blue", "yellow", "yellow", "red",
    ]);
    expect(latencyTone(null)).toBe("red");
  });

  it("grades loss as green under 1%, blue under 5%, yellow under 20%, red above", () => {
    expect([0, 0.99, 1, 4.99, 5, 19.99, 20, 100].map(lossTone)).toEqual([
      "green", "green", "blue", "blue", "yellow", "yellow", "red", "red",
    ]);
  });
});

describe("24-hour energy cells", () => {
  it("weights loss by actual attempts instead of averaging percentages", () => {
    const history = fleetHistory([
      { attempted_samples: 5, successful_samples: 3, packet_loss_percent: 40 },
      { attempted_samples: 395, successful_samples: 389, packet_loss_percent: 1.519 },
    ]);
    const cells = aggregateMetricEnergy("source-node", probe, "loss", history, history.server_time);
    const latest = cells.at(-1);

    expect(latest.value).toBeCloseTo(2, 6);
    expect(latest.tone).toBe("blue");
    expect(latest.attempted).toBe(400);
    expect(latest.successful).toBe(392);
    expect(windowLoss(cells)).toBeCloseTo(2, 6);
  });

  it("colors latency by the cell mean and turns a cell with no answers red", () => {
    const answered = fleetHistory([{ latency_ms: 70 }, { latency_ms: 100 }]);
    expect(aggregateMetricEnergy("source-node", probe, "latency", answered, answered.server_time).at(-1)).toMatchObject({
      value: 85,
      tone: "blue",
    });
    const silent = fleetHistory([{ latency_ms: null, success_percent: 0 }]);
    expect(aggregateMetricEnergy("source-node", probe, "latency", silent, silent.server_time).at(-1)).toMatchObject({
      value: null,
      tone: "red",
    });
  });
});
