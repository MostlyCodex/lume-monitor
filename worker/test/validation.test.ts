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
      region: "Region 1",
      stale_seconds: 180,
      display_order: 100,
      ip_change_severity: "P2",
    },
    generated_at: 1_800_000_000,
    system: {
      hostname: "node-a",
      os: "Debian",
      kernel: "6.12",
      boot_id: "boot-id",
      uptime_seconds: 100,
      cpu_percent: 1,
      memory_total_bytes: 1_000_000,
      memory_available_bytes: 900_000,
      root_total_bytes: 10_000_000,
      root_used_percent: 10,
      network_rx_bytes: 1,
      network_tx_bytes: 2,
    },
    services: [{ name: "example.service", label: "Example", severity: "P1", state: "active" }],
    probes: [
      {
        name: "external_icmp",
        label: "External ICMP",
        category: "external",
        kind: "icmp",
        warning_ms: 500,
        critical_ms: 1000,
        severity: "P2",
        display_order: 10,
        success: true,
        complete: true,
        duration_ms: 160,
        samples: 5,
        attempted_samples: 5,
        successful_samples: 5,
        checked_at: 1_800_000_000,
      },
    ],
    agent: { started_at: 1_799_999_000 },
  };
}

function firstProbe(report: Record<string, unknown>): Record<string, unknown> {
  return (report.probes as Array<Record<string, unknown>>)[0];
}

describe("report validation", () => {
  it("accepts a bounded valid report", () => {
    expect(validateReport(validReport()).node_id).toBe("future-vps-01");
  });

  it("accepts CPU capacity without requiring it", () => {
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

  it("keeps ICMP packet-loss thresholds and sample counts", () => {
    const report = validReport();
    Object.assign(firstProbe(report), { successful_samples: 4, warning_failure_percent: 10, critical_failure_percent: 40 });
    expect(validateReport(report).probes[0]).toMatchObject({
      kind: "icmp",
      attempted_samples: 5,
      successful_samples: 4,
      warning_failure_percent: 10,
      critical_failure_percent: 40,
    });
  });

  it("keeps TCP rounds to latency and reachability", () => {
    const report = validReport();
    Object.assign(firstProbe(report), {
      name: "peer_tcp_443",
      kind: "tcp",
      samples: 3,
      attempted_samples: 3,
      successful_samples: 2,
      warning_failure_percent: 1,
      critical_failure_percent: 60,
    });
    expect(validateReport(report).probes[0]).toMatchObject({
      kind: "tcp",
      success: true,
      successful_samples: 2,
      warning_failure_percent: 0,
      critical_failure_percent: 0,
    });
  });

  it("stores only the displayed values and drops anything else a report carries", () => {
    const report = validReport();
    Object.assign(report.node as Record<string, unknown>, { group: "default", color: "green", offline_severity: "P1" });
    Object.assign(report.system as Record<string, unknown>, { arch: "x86_64", load1: 0.1, swap_total_bytes: 0, network_rx_errors: 0 });
    Object.assign(firstProbe(report), { target: "example.com", jitter_ms: 1, sample_failure_percent: 0, error: "x" });
    Object.assign(report.agent as Record<string, unknown>, { queue_depth: 0, collect_errors: 0 });
    report.counters = [{ name: "retired" }];
    const current = validateReport(report);
    expect(current).toEqual(validateReport(validReport()));
    expect(JSON.stringify(current)).not.toMatch(/group|color|arch|load1|swap|errors|target"|jitter|sample_failure|queue_depth|counters/);
  });

  it("rejects dormant or ambiguous probe kinds", () => {
    for (const kind of ["tls", "http", "exec"]) {
      const report = validReport();
      firstProbe(report).kind = kind;
      expect(() => validateReport(report)).toThrow(/kind must be icmp or tcp/);
    }
  });

  it("rejects inconsistent probe counts and round status", () => {
    const report = validReport();
    Object.assign(firstProbe(report), { success: false, successful_samples: 4 });
    expect(() => validateReport(report)).toThrow(/success is inconsistent/);
    const interrupted = validReport();
    Object.assign(firstProbe(interrupted), { attempted_samples: 3, successful_samples: 3 });
    expect(() => validateReport(interrupted)).toThrow(/complete is inconsistent/);
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
    firstProbe(report).category = "node-link";
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

it("validates interface identities, cycle traffic and configuration fingerprints",()=>{
 const input=validReport();const system=input.system as Record<string,unknown>;const agent=input.agent as Record<string,unknown>;
 Object.assign(system,{network_interfaces:["eth0"],network_valid:true,network_scope:"a".repeat(64),traffic_cycle:{rx_bytes:123,tx_bytes:456}});
 agent.config_fingerprint="b".repeat(64);
 const report=validateReport(input);expect(report.system.traffic_cycle).toEqual({rx_bytes:123,tx_bytes:456});expect(report.agent.config_fingerprint).toBe("b".repeat(64));
 for (const patch of [{network_interfaces:["eth0","eth0"]},{network_interfaces:["../secret"]},{network_interfaces:["."]},{network_interfaces:[".."]},{network_valid:"true"},{network_valid:false},{network_scope:"invalid"},{traffic_cycle:{rx_bytes:-1,tx_bytes:0}},{traffic_cycle:{rx_bytes:1.5,tx_bytes:0}}]) expect(()=>validateReport({...input,system:{...system,...patch}})).toThrow();
 agent.config_fingerprint="untrusted";expect(()=>validateReport(input)).toThrow(/fingerprint/);
});
