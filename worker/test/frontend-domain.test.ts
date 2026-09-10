import { describe, expect, it } from "vitest";
import { normalizeLayout } from "../frontend/src/domain/layout";
import { displayNodes } from "../frontend/src/domain/nodes";
import { aggregateMetricEnergy } from "../frontend/src/domain/probes";
import { trafficSummary } from "../frontend/src/domain/traffic";
import { alignSeries } from "../frontend/src/charts/series";
import type { HistorySnapshot, LatestSnapshot, Probe } from "../frontend/src/types";

describe("frontend data boundaries", () => {
  it("keeps valid preferences while rejecting remote backgrounds, duplicate IDs and invalid countries", () => {
    const layout = normalizeLayout({
      brand: "  My Lume  ",
      background: "https://external.example/image.png",
      order: ["alpha", "alpha", "../bad"],
      nodes: { alpha: { label: "Alpha", country: "!x" }, "../bad": { label: "bad" } },
    });
    expect(layout.brand).toBe("My Lume");
    expect(layout.background).toBe("");
    expect(layout.order).toEqual(["alpha"]);
    expect(layout.nodes.alpha.country).toBe("");
    expect(Object.keys(layout.nodes)).toEqual(["alpha"]);
  });
  it("applies local ordering and labels without mutating monitoring data", () => {
    const latest: LatestSnapshot = {
      schema_version: 2,
      server_time: 1,
      catalog: {
        nodes: [
          { id: "a", label: "A", order: 1 },
          { id: "b", label: "B", order: 2 },
        ],
      },
      nodes: [{ id: "a", label: "A", online: true, metrics: { cpu_percent: 12 } }],
    };
    const before = JSON.stringify(latest);
    const nodes = displayNodes(
      latest,
      normalizeLayout({ order: ["b", "a"], nodes: { a: { label: "Custom" } } }),
    );
    expect(nodes.map((node) => node.id)).toEqual(["b", "a"]);
    expect(nodes[0].data_error).toBe(true);
    expect(nodes[1].label).toBe("Custom");
    expect(nodes[1].metrics.cpu_percent).toBe(12);
    expect(JSON.stringify(latest)).toBe(before);
  });
  it("preserves unknown measurements when aligning chart series", () => {
    expect(
      alignSeries([
        {
          label: "A",
          color: "red",
          points: [
            { x: 2, y: 10 },
            { x: 1, y: null },
          ],
        },
        {
          label: "B",
          color: "blue",
          points: [
            { x: 3, y: 0 },
            { x: 2, y: NaN },
          ],
        },
      ]),
    ).toEqual([
      [1, 2, 3],
      [null, 10, null],
      [null, null, 0],
    ]);
  });
  it("never falls back to system totals when cycle accounting is unavailable", () => {
    expect(
      trafficSummary({ network_valid: true, traffic_cycle_enabled: true, network_rx_bytes: 1024 }),
    ).toMatchObject({ label: "周期流量（估算）", rx: "—", tx: "—" });
    expect(trafficSummary({ network_valid: false, network_rx_bytes: 1024 }).rx).toBe("—");
  });
  it("does not count null latency or loss as a successful zero measurement", () => {
    const probe: Probe = { name: "carrier", kind: "icmp", samples: 5 };
    const history: HistorySnapshot = {
      schema_version: 2,
      server_time: 100000,
      hours: 24,
      bucket_seconds: 300,
      selected_node: null,
      metrics: [],
      annotations: [],
      probes: [
        {
          node_id: "a",
          probe_name: "carrier",
          timestamp: 99000,
          latency_ms: null,
          packet_loss_percent: null,
          sample_failure_percent: null,
        },
        {
          node_id: "a",
          probe_name: "carrier",
          timestamp: 99300,
          latency_ms: 120,
          packet_loss_percent: null,
          sample_failure_percent: null,
        },
      ],
    };
    expect(
      aggregateMetricEnergy("a", probe, "latency", history, history.server_time).at(-1)?.value,
    ).toBe(120);
    expect(
      aggregateMetricEnergy("a", probe, "loss", history, history.server_time).at(-1)?.empty,
    ).toBe(true);
  });
});
