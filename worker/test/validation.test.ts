import { describe, expect, it } from "vitest";
import {
  validateLegacyReport,
  validateReport,
  validateReportEnvelope,
  type LegacyReportMetadata,
} from "../src/validation";

function validReport(): Record<string, unknown> {
  return {
    schema_version: 2,
    agent_version: "1.0.0",
    node_id: "future-vps-01",
    node: {
      id: "future-vps-01",
      display_name: "Future VPS 01",
      short_mark: "F01",
      role: "VPS",
      group: "default",
      region: "Region 1",
      stale_seconds: 180,
      display_order: 100,
      color: "green",
      offline_severity: "P1",
      ip_change_severity: "P2",
    },
    generated_at: 1_800_000_000,
    system: {
      hostname: "node-a",
      os: "Debian",
      kernel: "6.12",
      arch: "x86_64",
      boot_id: "boot-id",
      uptime_seconds: 100,
      cpu_percent: 1,
      load1: 0.1,
      load5: 0.1,
      load15: 0.1,
      memory_total_bytes: 1_000_000,
      memory_available_bytes: 900_000,
      swap_total_bytes: 0,
      swap_used_bytes: 0,
      root_total_bytes: 10_000_000,
      root_free_bytes: 9_000_000,
      root_used_percent: 10,
      root_inode_used_percent: 2,
      network_rx_bytes: 1,
      network_tx_bytes: 2,
      network_rx_errors: 0,
      network_tx_errors: 0,
      network_rx_drops: 0,
      network_tx_drops: 0,
    },
    services: [{ name: "example.service", label: "Example", severity: "P1", state: "active" }],
    probes: [
      {
        name: "external_icmp",
        label: "External ICMP",
        category: "external",
        kind: "icmp",
        target: "example.com",
        warning_ms: 500,
        critical_ms: 1000,
        severity: "P2",
        display_order: 10,
        success: true,
        duration_ms: 160,
        checked_at: 1_800_000_000,
      },
    ],
    agent: { queue_depth: 0, collect_errors: 0, send_errors: 0, started_at: 1_799_999_000 },
  };
}

function legacyMetadata(): LegacyReportMetadata {
  return {
    node: {
      id: "legacy-node",
      display_name: "Legacy Node",
      short_mark: "LG",
      role: "Relay",
      group: "default",
      region: "Region 1",
      stale_seconds: 180,
      display_order: 10,
      color: "green",
      offline_severity: "P1",
      ip_change_severity: "P2",
    },
    services: [{ name: "example.service", label: "Example", severity: "P1" }],
    probes: [
      {
        name: "legacy_link",
        label: "Legacy link",
        category: "route",
        target_node_id: "destination-node",
        warning_ms: 50,
        critical_ms: 100,
        severity: "P2",
        display_order: 10,
        primary: true,
      },
    ],
  };
}

function legacyReport(): Record<string, unknown> {
  const current = validReport();
  return {
    ...current,
    schema_version: 1,
    node_id: "legacy-node",
    role: "legacy",
    node: undefined,
    services: [{ name: "example.service", state: "active" }],
    probes: [
      {
        name: "legacy_link",
        kind: "icmp",
        target: "example.com",
        success: true,
        duration_ms: 20,
        checked_at: 1_800_000_000,
      },
    ],
  };
}

describe("report validation", () => {
  it("accepts a bounded valid report", () => {
    expect(validateReport(validReport()).node_id).toBe("future-vps-01");
  });

  it("normalizes an ICMP round with explicit packet loss", () => {
    const report = validReport();
    const probe = (report.probes as Array<Record<string, unknown>>)[0];
    Object.assign(probe, {
      kind: "icmp",
      target: "198.51.100.1",
      success: true,
      complete: true,
      samples: 5,
      attempted_samples: 5,
      successful_samples: 4,
      sample_failure_percent: 20,
      packet_loss_percent: 20,
      warning_failure_percent: 10,
      critical_failure_percent: 40,
    });
    expect(validateReport(report).probes[0]).toMatchObject({
      kind: "icmp",
      successful_samples: 4,
      packet_loss_percent: 20,
      sample_failure_percent: 20,
    });
  });

  it("rejects non-ICMP probe kinds", () => {
    for (const kind of ["tcp", "tls"]) {
      const report = validReport();
      const probe = (report.probes as Array<Record<string, unknown>>)[0];
      probe.kind = kind;
      expect(() => validateReport(report)).toThrow(/kind must be icmp/);
    }
  });

  it("rejects inconsistent probe counts and round status", () => {
    const report = validReport();
    const probe = (report.probes as Array<Record<string, unknown>>)[0];
    Object.assign(probe, {
      success: false,
      complete: true,
      samples: 5,
      attempted_samples: 5,
      successful_samples: 4,
      sample_failure_percent: 20,
    });
    expect(() => validateReport(report)).toThrow(/success is inconsistent/);
  });

  it("rejects a node metadata mismatch", () => {
    const report = validReport();
    (report.node as Record<string, unknown>).id = "another-vps";
    expect(() => validateReport(report)).toThrow(/must match/);
  });

  it("accepts pure host monitoring without optional checks", () => {
    const report = validReport();
    report.services = [];
    report.probes = [];
    expect(validateReport(report).probes).toEqual([]);
  });

  it("requires a destination identity for node-link probes", () => {
    const report = validReport();
    const probe = (report.probes as Array<Record<string, unknown>>)[0];
    probe.category = "node-link";
    expect(() => validateReport(report)).toThrow(/target_node_id/);
  });

  it("rejects out-of-range percentages", () => {
    const report = validReport();
    (report.system as Record<string, unknown>).cpu_percent = 101;
    expect(() => validateReport(report)).toThrow(/cpu_percent/);
  });

  it("authenticates a legacy envelope before catalog normalization", () => {
    expect(validateReportEnvelope(legacyReport())).toEqual({
      schema_version: 1,
      node_id: "legacy-node",
      generated_at: 1_800_000_000,
    });
  });

  it("normalizes a schema v1 report with catalog metadata", () => {
    const report = validateLegacyReport(legacyReport(), legacyMetadata());
    expect(report.schema_version).toBe(2);
    expect(report.node.display_name).toBe("Legacy Node");
    expect(report.services[0]).toMatchObject({ label: "Example", severity: "P1" });
    expect(report.probes[0]).toMatchObject({
      label: "Legacy link",
      category: "node-link",
      target_node_id: "destination-node",
      warning_ms: 50,
      primary: true,
    });
  });

  it("rejects a legacy probe that is absent from the catalog", () => {
    const metadata = legacyMetadata();
    metadata.probes = [];
    expect(() => validateLegacyReport(legacyReport(), metadata)).toThrow(/metadata is missing/);
  });
});
