import { describe, expect, it } from "vitest";
import {
  validateReport,
  validateReportEnvelope,
} from "../src/validation";

function validReport(): Record<string, unknown> {
  return {
    schema_version: 2,
    agent_version: "1.0.0",
    node_id: "future-vps-01",
    node: {
      id: "future-vps-01",
      display_name: "Future VPS 01",
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

describe("report validation", () => {
  it("accepts a bounded valid report", () => {
    expect(validateReport(validReport()).node_id).toBe("future-vps-01");
  });

  it("accepts CPU capacity without requiring existing Agents to report it", () => {
    const report = validReport();
    expect(validateReport(report).system.cpu_count).toBeUndefined();
    (report.system as Record<string, unknown>).cpu_count = 4;
    expect(validateReport(report).system.cpu_count).toBe(4);
  });

  it.each([0, -1, 1.5, "2", null, NaN, Infinity, 65537])("rejects invalid CPU capacity %s", (value) => {
    const report = validReport();
    (report.system as Record<string, unknown>).cpu_count = value;
    expect(() => validateReport(report)).toThrow("system.cpu_count");
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

  it("accepts TCP reachability without mislabeling failures as packet loss", () => {
    const report = validReport();
    const probe = (report.probes as Array<Record<string, unknown>>)[0];
    Object.assign(probe, {
      name: "peer_tcp_443",
      kind: "tcp",
      port: 443,
      samples: 3,
      attempted_samples: 3,
      successful_samples: 2,
      sample_failure_percent: 100 / 3,
      complete: true,
      success: true,
    });
    delete probe.packet_loss_percent;
    const parsed = validateReport(report).probes[0];
    expect(parsed).toMatchObject({ kind: "tcp", port: 443, successful_samples: 2 });
    expect(parsed.packet_loss_percent).toBeUndefined();
  });

  it("rejects dormant or ambiguous probe kinds", () => {
    for (const kind of ["tls", "http", "exec"]) {
      const report = validReport();
      const probe = (report.probes as Array<Record<string, unknown>>)[0];
      probe.kind = kind;
      expect(() => validateReport(report)).toThrow(/kind must be icmp or tcp/);
    }
  });

  it("ignores retired counters from older Agents without discarding host or probe data", () => {
    const report = validReport();
    report.counters = [{ name: "retired", complete: false, error: "snapshot unavailable" }];
    const current = validateReport(report);
    expect(current).not.toHaveProperty("counters");
    expect(current.system).toEqual(validateReport(validReport()).system);
    expect(current.probes).toEqual(validateReport(validReport()).probes);
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

  it("rejects unsupported report schemas before storage", () => {
    for (const schema_version of [1, 3, "2", null])
      expect(() => validateReportEnvelope({ ...validReport(), schema_version })).toThrow(/schema_version/);
  });
});

it("validates interface identities, optional traffic periods and configuration fingerprints",()=>{
 const input=validReport();const system=input.system as Record<string,unknown>;const agent=input.agent as Record<string,unknown>;
 Object.assign(system,{network_interfaces:["eth0"],network_valid:true,network_scope:"a".repeat(64),traffic_cycle:{reset_day:1,time_zone:"UTC",period_start:100,period_end:2678500,observed_since:200,rx_bytes:123,tx_bytes:456,partial:true}});
 agent.config_fingerprint="b".repeat(64);
 const report=validateReport(input);expect(report.system.traffic_cycle?.rx_bytes).toBe(123);expect(report.agent.config_fingerprint).toBe("b".repeat(64));
 for (const patch of [{network_interfaces:["eth0","eth0"]},{network_interfaces:["../secret"]},{network_interfaces:["."]},{network_interfaces:[".."]},{network_valid:"true"},{network_valid:false},{network_scope:"invalid"},{traffic_cycle:{...(system.traffic_cycle as object),reset_day:32}},{traffic_cycle:{...(system.traffic_cycle as object),partial:"yes"}},{traffic_cycle:{...(system.traffic_cycle as object),time_zone:"local"}}]) expect(()=>validateReport({...input,system:{...system,...patch}})).toThrow();
 agent.config_fingerprint="untrusted";expect(()=>validateReport(input)).toThrow(/fingerprint/);
});
