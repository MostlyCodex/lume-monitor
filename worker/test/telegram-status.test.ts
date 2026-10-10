import { describe, expect, it } from "vitest";
import type { NodeCatalogRow, ProbeCatalogRow } from "../src/catalog";
import { formatTelegramStatusMessage, type TelegramStatusNodeRow } from "../src/telegram-status";
import type { AgentReport, ProbeResult } from "../src/types";

const now = 1_800_000_000;

function catalog(overrides: Partial<NodeCatalogRow> = {}): NodeCatalogRow {
  return {
    node_id: "edge-one",
    public_id: "public-one",
    display_name: "示例节点",
    role_label: "VPS",
    region_label: "Example",
    stale_seconds: 180,
    display_order: 10,
    enabled: 1,
    retired_at: null,
    ...overrides,
  };
}

function icmpProbe(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    name: "beijing-telecom",
    label: "北京电信",
    category: "china-network",
    kind: "icmp",
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
      role: "VPS",
      region: "Example",
      stale_seconds: 180,
      display_order: 10,
      ip_change_severity: "P2",
    },
    generated_at: now - 20,
    system: {
      hostname: "example-host",
      os: "Linux",
      kernel: "6.1",
      boot_id: "00000000-0000-0000-0000-000000000000",
      uptime_seconds: 1000,
      cpu_percent: 3.2,
      memory_total_bytes: 1000,
      memory_available_bytes: 860,
      root_total_bytes: 1000,
      root_used_percent: 11.2,
      network_rx_bytes: 100,
      network_tx_bytes: 200,
    },
    services: [{ name: "nftables", label: "nftables", severity: "P1", state: "active" }],
    probes: [icmpProbe()],
    agent: { started_at: now - 1000 },
    ...overrides,
  };
}

// Only probes the catalog still exposes reach /status, so the fixtures build
// the catalog rows the reports imply unless a test deliberately omits one.
function probeCatalog(reports: AgentReport[]): ProbeCatalogRow[] {
  return reports.flatMap((value) =>
    value.probes.map((probe) => ({
      node_id: value.node_id,
      probe_name: probe.name,
      public_id: probe.name,
      display_name: probe.label,
      category: probe.category,
      kind: probe.kind,
      target_node_id: probe.target_node_id ?? null,
      warning_ms: probe.warning_ms,
      critical_ms: probe.critical_ms,
      warning_failure_percent: probe.warning_failure_percent,
      critical_failure_percent: probe.critical_failure_percent,
      severity: probe.severity,
      display_order: probe.display_order,
      enabled: 1,
    })),
  );
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
    const message = formatTelegramStatusMessage([catalog()], probeCatalog([report()]), [row(report())], now);

    expect(message).toContain("◇ Lume · 最新状态");
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
      probeCatalog([minimal]),
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
      probes: [icmpProbe({ successful_samples: 4, duration_ms: 170 })],
    });
    const message = formatTelegramStatusMessage([catalog()], probeCatalog([unhealthy]), [row(unhealthy)], now);

    expect(message).toContain("🟡 示例节点");
    expect(message).toContain("Xray 异常（inactive）");
    expect(message).toContain("北京电信 · 170 ms · 丢包 20%");
  });

  it("shows TCP probes as latency or an unreachable target, never as a failure rate", () => {
    const tcp = (overrides: Partial<ProbeResult>) => icmpProbe({
      kind: "tcp", label: "Cloudflare", samples: 3, attempted_samples: 3, successful_samples: 3,
      warning_failure_percent: 0, critical_failure_percent: 0, ...overrides,
    });
    const value = report({
      probes: [
        tcp({ name: "cf", duration_ms: 23.4, successful_samples: 2, display_order: 10 }),
        tcp({ name: "google", label: "Google", success: false, successful_samples: 1, display_order: 20 }),
        icmpProbe({ name: "ct", display_order: 30 }),
        icmpProbe({ name: "cu", label: "北京联通", display_order: 40 }),
        icmpProbe({ name: "cm", label: "北京移动", display_order: 50 }),
      ],
    });
    const message = formatTelegramStatusMessage([catalog()], probeCatalog([value]), [row(value)], now);

    expect(message).toContain("├ Cloudflare · 23 ms\n");
    expect(message).toContain("├ Google · 连接失败");
    expect(message).toContain("└ 北京移动 · 152 ms · 丢包 0%");
    expect(message).not.toContain("建连失败");
  });

  it("hides a probe the catalog no longer exposes, such as a link to a retired node", () => {
    const linked = report({
      probes: [
        icmpProbe(),
        icmpProbe({
          name: "retired-peer",
          label: "已下线节点",
          category: "node-link",
          target_node_id: "retired-vps",
          success: false,
          severity: "P1",
          display_order: 5,
        }),
      ],
    });
    // The catalog keeps only the first probe: the peer is retired.
    const visible = probeCatalog([linked]).filter((probe) => probe.target_node_id === null);
    const message = formatTelegramStatusMessage([catalog()], visible, [row(linked)], now);

    expect(message).not.toContain("已下线节点");
    expect(message).toContain("北京电信");
    // A failing retired link must not colour the node either.
    expect(message).toContain("🟢 示例节点");
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
    const reports = catalogs.map((meta) =>
      report({ node_id: meta.node_id, node: { ...report().node, id: meta.node_id } }),
    );
    const message = formatTelegramStatusMessage(catalogs, probeCatalog(reports), rows, now);

    expect(message.length).toBeLessThanOrEqual(4000);
    expect(message).toContain("个节点，请在面板查看");
    expect(message).toContain("/panel 打开监控面板");
  });
});
