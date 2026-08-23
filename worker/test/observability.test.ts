import { describe, expect, it } from "vitest";
import { computeNetworkRates, percentile, summarizeRoute, type ProbeSampleRow } from "../src/observability";
import type { AgentReport } from "../src/types";

function report(generatedAt: number, bootId: string, rx: number, tx: number): AgentReport {
  return {
    schema_version: 2,
    agent_version: "2.0.0",
    node_id: "test-vps",
    node: {
      id: "test-vps",
      display_name: "Test VPS",
      short_mark: "TV",
      role: "VPS",
      group: "default",
      region: "test",
      stale_seconds: 180,
      display_order: 100,
      color: "green",
      offline_severity: "P1",
      ip_change_severity: "P2",
    },
    generated_at: generatedAt,
    system: {
      hostname: "host",
      os: "Linux",
      kernel: "6.1",
      arch: "x86_64",
      boot_id: bootId,
      uptime_seconds: 100,
      cpu_percent: 1,
      load1: 0,
      load5: 0,
      load15: 0,
      memory_total_bytes: 1,
      memory_available_bytes: 1,
      swap_total_bytes: 0,
      swap_used_bytes: 0,
      root_total_bytes: 1,
      root_free_bytes: 1,
      root_used_percent: 1,
      root_inode_used_percent: 1,
      network_rx_bytes: rx,
      network_tx_bytes: tx,
      network_rx_errors: 0,
      network_tx_errors: 0,
      network_rx_drops: 0,
      network_tx_drops: 0,
    },
    services: [],
    probes: [],
    agent: { queue_depth: 0, collect_errors: 0, send_errors: 0, started_at: 1 },
  };
}

function probe(timestamp: number, duration: number, success = true): ProbeSampleRow {
  return {
    node_id: "test-vps",
    probe_name: "peer_icmp",
    checked_at: timestamp,
    success: success ? 1 : 0,
    duration_ms: duration,
    average_duration_ms: success ? duration : null,
    p95_duration_ms: success ? duration + 1 : null,
    min_duration_ms: success ? duration - 1 : null,
    max_duration_ms: success ? duration + 1 : null,
    range_ms: success ? 2 : null,
    jitter_ms: success ? 1 : null,
    samples: 3,
    attempted_samples: 3,
    successful_samples: success ? 3 : 0,
    sample_failure_percent: success ? 0 : 100,
    packet_loss_percent: success ? 0 : 100,
    complete: 1,
  };
}

describe("observability statistics", () => {
  it("uses an interpolated percentile and does not mutate input", () => {
    const values = [40, 10, 20, 30];
    expect(percentile(values, 0.5)).toBe(25);
    expect(percentile(values, 0.95)).toBeCloseTo(38.5);
    expect(values).toEqual([40, 10, 20, 30]);
  });

  it("derives byte rates only across a valid monotonic interval", () => {
    expect(computeNetworkRates(report(160, "boot", 7_000, 9_000), report(100, "boot", 1_000, 3_000))).toEqual({
      rxBps: 100,
      txBps: 100,
    });
    expect(computeNetworkRates(report(160, "new", 1, 1), report(100, "old", 9_000, 9_000))).toEqual({
      rxBps: null,
      txBps: null,
    });
  });

  it("separates availability, SLA compliance and statistical anomalies", () => {
    const rows = [probe(1, 9), probe(2, 10), probe(3, 11), probe(4, 12), probe(5, 90), probe(6, 0, false)];
    const summary = summarizeRoute(rows, 30, 50);
    expect(summary.rounds).toBe(6);
    expect(summary.availability_percent).toBeCloseTo(83.333, 2);
    expect(summary.latency_p50_ms).toBe(11);
    expect(summary.latency_p95_ms).toBeCloseTo(74.4);
    expect(summary.sla_compliance_percent).toBeCloseTo(66.667, 2);
    expect(summary.anomalies).toHaveLength(2);
    expect(summary.anomalies.some((item) => item.success === false)).toBe(true);
  });

  it("reports ICMP loss separately from collection coverage", () => {
    const lossy = {
      ...probe(1, 12),
      samples: 5,
      attempted_samples: 5,
      successful_samples: 4,
      sample_failure_percent: 20,
      packet_loss_percent: 20,
    };
    const summary = summarizeRoute([lossy], 30, 50, 10, 40);
    expect(summary.packet_loss_percent).toBe(20);
    expect(summary.sample_failure_percent).toBe(20);
    expect(summary.sample_coverage_percent).toBe(100);
    expect(summary.anomalies[0]).toMatchObject({ severity: "warning", reason: "丢包率 20.0%" });
  });

  it("keeps ICMP packet loss distinct from collection coverage", () => {
    const partial = {
      ...probe(1, 12, false),
      samples: 5,
      attempted_samples: 3,
      successful_samples: 2,
      sample_failure_percent: 100 / 3,
      complete: 0,
    };
    const summary = summarizeRoute([partial], 30, 50, 20, 50);
    expect(summary.packet_loss_percent).toBeCloseTo(100 / 3);
    expect(summary.sample_failure_percent).toBeCloseTo(100 / 3);
    expect(summary.sample_coverage_percent).toBe(60);
  });
});
