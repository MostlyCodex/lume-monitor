import { describe, expect, it } from "vitest";
import type { NodeCatalogRow } from "../src/catalog";
import { formatTelegramStatusMessage, type TelegramStatusNodeRow } from "../src/telegram-status";
import type { AgentReport, ProbeResult } from "../src/types";

const now = 1_800_000_000;

function catalog(overrides: Partial<NodeCatalogRow> = {}): NodeCatalogRow {
  return {
    node_id: "edge-one",
    public_id: "public-one",
    display_name: "示例节点",
    short_mark: "E1",
    role_label: "VPS",
    group_name: "default",
    region_label: "Example",
    stale_seconds: 180,
    display_order: 10,
    color_key: "blue",
    offline_severity: "P1",
    ip_change_severity: "P2",
    enabled: 1,
    ...overrides,
  };
}

function icmpProbe(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    name: "beijing-telecom",
    label: "北京电信",
    category: "china-network",
    kind: "icmp",
    target: "example.invalid",
    warning_ms: 180,
    critical_ms: 250,
    warning_failure_percent: 5,
    critical_failure_percent: 20,
    severity: "P2",
    display_order: 10,
    success: true,
    complete: true,
    duration_ms: 152.4,
    samples: 5,
    attempted_samples: 5,
    successful_samples: 5,
    sample_failure_percent: 0,
    packet_loss_percent: 0,
    checked_at: now - 20,
    ...overrides,
  };
}

function report(overrides: Partial<AgentReport> = {}): AgentReport {
  return {
    schema_version: 2,
    agent_version: "1.0.0",
    node_id: "edge-one",
    node: {
      id: "edge-one",
      display_name: "示例节点",
      short_mark: "E1",
      role: "VPS",
      group: "default",
      region: "Example",
      stale_seconds: 180,
      display_order: 10,
      color: "blue",
      offline_severity: "P1",
      ip_change_severity: "P2",
    },
    generated_at: now - 20,
    system: {
      hostname: "example-host",
      os: "Linux",
      kernel: "6.1",
      arch: "x86_64",
      boot_id: "00000000-0000-0000-0000-000000000000",
      uptime_seconds: 1000,
      cpu_percent: 3.2,
      load1: 0.1,
      load5: 0.1,
      load15: 0.1,
      memory_total_bytes: 1000,
      memory_available_bytes: 860,
      swap_total_bytes: 0,
      swap_used_bytes: 0,
      root_total_bytes: 1000,
      root_free_bytes: 890,
      root_used_percent: 11.2,
      root_inode_used_percent: 2,
      network_rx_bytes: 100,
      network_tx_bytes: 200,
      network_rx_errors: 0,
      network_tx_errors: 0,
      network_rx_drops: 0,
      network_tx_drops: 0,
    },
    services: [{ name: "nftables", label: "nftables", severity: "P1", state: "active" }],
    probes: [icmpProbe()],
    agent: { queue_depth: 0, collect_errors: 0, send_errors: 0, started_at: now - 1000 },
    ...overrides,
  };
}

function row(value: AgentReport, overrides: Partial<TelegramStatusNodeRow> = {}): TelegramStatusNodeRow {
  return {
    node_id: value.node_id,
    received_at: now - 20,
    report_json: JSON.stringify(value),
    ...overrides,
  };
}

describe("Telegram status formatting", () => {
  it("renders a compact node summary without exposing an IP field", () => {
    const message = formatTelegramStatusMessage([catalog()], [row(report())], now);

    expect(message).toContain("◇ Aegilume · 最新状态");
    expect(message).toContain("在线  1/1");
    expect(message).toContain("🟢 示例节点");
    expect(message).toContain("更新  20秒前");
    expect(message).toContain("资源  CPU 3% · RAM 14% · 磁盘 11%");
    expect(message).toContain("服务  nftables 正常");
    expect(message).toContain("└ 北京电信 · 152 ms · 丢包 0%");
    expect(message).toContain("/panel 打开监控面板");
    expect(message).not.toContain("上报源");
    expect(message).not.toMatch(/(?:\d{1,3}\.){3}\d{1,3}/);
    expect(message).not.toContain("2001:db8");
  });

  it("omits unconfigured sections and clearly marks a stale node", () => {
    const minimal = report({ services: [], probes: [] });
    const message = formatTelegramStatusMessage(
      [catalog()],
      [row(minimal, { received_at: now - 600 })],
      now,
    );

    expect(message).toContain("在线  0/1");
    expect(message).toContain("🔴 示例节点");
    expect(message).toContain("更新  10分前");
    expect(message).not.toContain("未配置");
  });

  it("uses ICMP packet loss and highlights an unhealthy service", () => {
    const unhealthy = report({
      services: [{ name: "xray", label: "Xray", severity: "P2", state: "inactive" }],
      probes: [icmpProbe({ packet_loss_percent: 20, sample_failure_percent: 40, duration_ms: 170 })],
    });
    const message = formatTelegramStatusMessage([catalog()], [row(unhealthy)], now);

    expect(message).toContain("🟡 示例节点");
    expect(message).toContain("Xray 异常（inactive）");
    expect(message).toContain("北京电信 · 170 ms · 丢包 20%");
    expect(message).not.toContain("40%");
  });

  it("keeps large fleets within Telegram's message limit and directs overflow to the panel", () => {
    const catalogs = Array.from({ length: 80 }, (_, index) => catalog({
      node_id: `node-${index}`,
      display_name: `示例节点-${String(index).padStart(2, "0")}`,
      display_order: index,
    }));
    const rows = catalogs.map((meta) => {
      const value = report({ node_id: meta.node_id, node: { ...report().node, id: meta.node_id } });
      return row(value);
    });
    const message = formatTelegramStatusMessage(catalogs, rows, now);

    expect(message.length).toBeLessThanOrEqual(4000);
    expect(message).toContain("个节点，请在面板查看");
    expect(message).toContain("/panel 打开监控面板");
  });
});
