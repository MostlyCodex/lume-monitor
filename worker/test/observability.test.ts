import { describe, expect, it } from "vitest";
import { computeNetworkRates } from "../src/observability";
import type { AgentReport } from "../src/types";
import { packetLossPercent } from "../src/validation";

function report(generatedAt: number, bootId: string, rx: number, tx: number): AgentReport {
  return {
    schema_version: 2,
    agent_version: "2.0.0",
    node_id: "test-vps",
    node: {
      id: "test-vps",
      display_name: "Test VPS",
      role: "VPS",
      region: "test",
      stale_seconds: 180,
      display_order: 100,
      ip_change_severity: "P2",
    },
    generated_at: generatedAt,
    system: {
      hostname: "host",
      os: "Linux",
      kernel: "6.1",
      boot_id: bootId,
      uptime_seconds: 100,
      cpu_percent: 1,
      memory_total_bytes: 1,
      memory_available_bytes: 1,
      root_total_bytes: 1,
      root_used_percent: 1,
      network_rx_bytes: rx,
      network_tx_bytes: tx,
    },
    services: [],
    probes: [],
    agent: { started_at: 1 },
  };
}

describe("observability statistics", () => {
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

  it("derives ICMP packet loss from sample counts and never reports loss for TCP", () => {
    const base = {
      name: "peer", label: "Peer", category: "external", warning_ms: 0, critical_ms: 0,
      warning_failure_percent: 0, critical_failure_percent: 0, severity: "P2" as const, display_order: 10,
      success: true, complete: true, duration_ms: 12, samples: 5, checked_at: 1,
    };
    expect(packetLossPercent({ ...base, kind: "icmp", attempted_samples: 5, successful_samples: 4 })).toBe(20);
    expect(packetLossPercent({ ...base, kind: "icmp", attempted_samples: 0, successful_samples: 0 })).toBe(100);
    expect(packetLossPercent({ ...base, kind: "tcp", attempted_samples: 3, successful_samples: 2 })).toBeNull();
  });
});

it("starts a new rate baseline when selected interfaces change, disappear or are recreated",()=>{
 const before=report(100,"boot",1000,2000),after=report(160,"boot",1600,2600);
 before.system.network_interfaces=["eth0"];before.system.network_scope="a".repeat(64);before.system.network_valid=true;
 after.system.network_interfaces=["eth0"];after.system.network_scope="a".repeat(64);after.system.network_valid=true;
 expect(computeNetworkRates(after,before)).toEqual({rxBps:10,txBps:10});
 after.system.network_scope="b".repeat(64);expect(computeNetworkRates(after,before)).toEqual({rxBps:null,txBps:null});
 after.system.network_scope=before.system.network_scope;after.system.network_interfaces=["eth1"];expect(computeNetworkRates(after,before)).toEqual({rxBps:null,txBps:null});
 after.system.network_interfaces=["eth0"];after.system.network_valid=false;expect(computeNetworkRates(after,before)).toEqual({rxBps:null,txBps:null});
});
