import { describe, expect, it } from "vitest";
import { normalizeLayout } from "../frontend/src/domain/layout";
import { displayNodes } from "../frontend/src/domain/nodes";
import { aggregateMetricEnergy } from "../frontend/src/domain/probes";
import { trafficSummary } from "../frontend/src/domain/traffic";
import type { HistorySnapshot, LatestSnapshot, Probe } from "../frontend/src/types";

describe("frontend data boundaries", () => {
  it("keeps only a valid node order and drops legacy display overrides", () => {
    const layout = normalizeLayout({
      brand: "  My Lume  ",
      background: "data:image/png;base64,AAAA",
      order: ["alpha", "alpha", "../bad"],
      nodes: { alpha: { label: "Alpha" } },
    });
    expect(layout).toEqual({ order: ["alpha"] });
  });
  it("applies local ordering without mutating monitoring data", () => {
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
    expect(nodes[1].label).toBe("A");
    expect(nodes[1].metrics.cpu_percent).toBe(12);
    expect(JSON.stringify(latest)).toBe(before);
  });
  it("shows cycle traffic only and leaves it unknown until the Agent reports it", () => {
    expect(trafficSummary({ network_valid: true })).toEqual({ label: "周期流量", rx: "—", tx: "—" });
    expect(trafficSummary({ network_valid: false, traffic_cycle: { rx_bytes: 1024, tx_bytes: 0 } }).rx).toBe("—");
    expect(trafficSummary({ network_valid: true, traffic_cycle: { rx_bytes: 1024, tx_bytes: 0 } }).rx).not.toBe("—");
  });
  it("does not count null latency or loss as a successful zero measurement", () => {
    const probe: Probe = { name: "carrier", kind: "icmp", samples: 5 };
    const history: HistorySnapshot = {
      schema_version: 2,
      server_time: 100000,
      hours: 24,
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
        },
        {
          node_id: "a",
          probe_name: "carrier",
          timestamp: 99300,
          latency_ms: 120,
          packet_loss_percent: null,
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
