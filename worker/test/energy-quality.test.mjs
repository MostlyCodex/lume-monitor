import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

function dashboardQualityInternals() {
  const app = readFileSync(new URL("../public/dashboard/app.js", import.meta.url), "utf8");
  const marker = /  init\(\);\r?\n\}\)\(\);\r?\n?$/;
  expect(marker.test(app)).toBe(true);
  const instrumented = app.replace(
    marker,
    "  globalThis.__dashboardQuality = { energyLossSeverity, aggregateMetricEnergy };\n})();\n",
  );
  const context = vm.createContext({
    URLSearchParams,
    location: { search: "" },
  });
  new vm.Script(instrumented, { filename: "dashboard/app.js" }).runInContext(context);
  return context.__dashboardQuality;
}

function fleetHistory(rows) {
  const serverTime = 1_000_000;
  return {
    server_time: serverTime,
    probes: rows.map((row, index) => ({
      node_id: "source-node",
      probe_name: "carrier",
      timestamp: serverTime - 4_500 + index * 300,
      rounds: 1,
      ...row,
    })),
  };
}

const probe = {
  name: "carrier",
  samples: 5,
  warning_failure_percent: 20,
  critical_failure_percent: 60,
};

describe("24-hour packet-loss energy cells", () => {
  const { energyLossSeverity, aggregateMetricEnergy } = dashboardQualityInternals();

  it("uses independent 2% and 10% historical thresholds", () => {
    expect(energyLossSeverity(0)).toBe("healthy");
    expect(energyLossSeverity(2)).toBe("healthy");
    expect(energyLossSeverity(2.01)).toBe("warning");
    expect(energyLossSeverity(10)).toBe("warning");
    expect(energyLossSeverity(10.01)).toBe("critical");
  });

  it("weights loss by actual Echo attempts instead of averaging percentages", () => {
    const history = fleetHistory([
      { attempted_samples: 5, successful_samples: 3, packet_loss_percent: 40 },
      { attempted_samples: 395, successful_samples: 389, packet_loss_percent: 1.519 },
    ]);
    const latest = aggregateMetricEnergy("source-node", probe, "loss", history).at(-1);

    expect(latest.value).toBeCloseTo(2, 6);
    expect(latest.severity).toBe("healthy");
    expect(latest.attempted).toBe(400);
    expect(latest.successful).toBe(392);
  });

  it("marks a cell critical when a five-minute sub-bucket reaches 60% loss", () => {
    const history = fleetHistory([
      { attempted_samples: 25, successful_samples: 10, packet_loss_percent: 60 },
      { attempted_samples: 975, successful_samples: 975, packet_loss_percent: 0 },
    ]);
    const latest = aggregateMetricEnergy("source-node", probe, "loss", history).at(-1);

    expect(latest.value).toBeCloseTo(1.5, 6);
    expect(latest.severeFiveMinuteLoss).toBe(true);
    expect(latest.severity).toBe("critical");
  });
});
