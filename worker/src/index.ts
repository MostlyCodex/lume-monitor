import { canonicalMessage, constantTimeEqual, hmacHex, parseNodeKeys } from "./auth";
import { loadDashboardCatalog } from "./catalog";
import {
  clearDashboardSessionCookie,
  cleanupDashboardAuth,
  consumeDashboardLogin,
  hasDashboardSession,
  issueDashboardLogin,
  newDashboardSessionCookie,
} from "./dashboard-auth";
import { dashboardHistoryData, latestDashboardData, normalizeHistoryHours } from "./dashboard-data";
import {
  compactRecentObservability,
  computeNetworkRates,
  metricSampleStatement,
  probeRoundStatement,
  rebuildObservabilityDay,
} from "./observability";
import {
  configureTelegramWebhook,
  ensureTelegramCommandMenu,
  ensureTelegramWebhook,
  processTelegramWebhookUpdate,
  telegramDiagnostics,
  type TelegramCommand,
  type TelegramUpdate,
} from "./telegram";
import { formatTelegramStatusMessage, type TelegramStatusNodeRow } from "./telegram-status";
import type {
  AgentReport,
  Env,
  NodeId,
  Severity,
  SourceIdentity,
} from "./types";
import {
  validateLegacyReport,
  validateReport,
  validateReportEnvelope,
  type LegacyReportMetadata,
  type ReportEnvelope,
} from "./validation";

const MAX_BODY_BYTES = 64 * 1024;
const DAY_SECONDS = 24 * 60 * 60;

function securityHeaders(contentType: string): HeadersInit {
  return {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: securityHeaders("application/json; charset=utf-8"),
  });
}

function text(value: string, status = 200): Response {
  return new Response(value, {
    status,
    headers: securityHeaders("text/plain; charset=utf-8"),
  });
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function reportMaxAgeSeconds(env: Env): number {
  return Math.max(60, Math.min(900, Number(env.REPORT_MAX_AGE_SECONDS) || 300));
}

function nextRecentNonces(raw: string | null | undefined, nonce: string, now: number, maxAge: number): string | null {
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(raw ?? "[]");
  } catch {
    parsed = [];
  }
  const active: Array<[string, number]> = Array.isArray(parsed)
    ? parsed
        .filter((entry): entry is [string, number] =>
          Array.isArray(entry) && typeof entry[0] === "string" && Number.isInteger(entry[1]) && now - entry[1] <= maxAge
        )
        .slice(-40)
    : [];
  if (active.some(([value]) => value === nonce)) return null;
  return JSON.stringify([...active, [nonce, now]].slice(-40));
}

function sourceIdentity(request: Request): SourceIdentity {
  const cf = ((request as Request & { cf?: Record<string, unknown> }).cf ?? {}) as Record<string, unknown>;
  const asn = typeof cf.asn === "number" && Number.isInteger(cf.asn) ? cf.asn : null;
  return {
    ip: request.headers.get("CF-Connecting-IP"),
    asn,
    org: typeof cf.asOrganization === "string" ? cf.asOrganization.slice(0, 160) : null,
    country: typeof cf.country === "string" ? cf.country.slice(0, 8) : null,
    colo: typeof cf.colo === "string" ? cf.colo.slice(0, 8) : null,
  };
}

export function maskIp(ip: string | null): string {
  if (!ip) return "未知";
  if (ip.includes(".")) {
    const parts = ip.split(".");
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.x` : "已隐藏";
  }
  const parts = ip.split(":").filter(Boolean);
  return parts.length ? `${parts.slice(0, 4).join(":")}::/64` : "已隐藏";
}

async function authenticateReport(
  request: Request,
  body: string,
  report: Pick<ReportEnvelope, "node_id" | "generated_at">,
  env: Env,
  now: number,
): Promise<{ nonce: string } | Response> {
  const headerNode = request.headers.get("X-Vpsmon-Node") ?? "";
  const timestamp = request.headers.get("X-Vpsmon-Timestamp") ?? "";
  const nonce = request.headers.get("X-Vpsmon-Nonce") ?? "";
  const provided = (request.headers.get("X-Vpsmon-Signature") ?? "").replace(/^sha256=/i, "");
  if (headerNode !== report.node_id || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce) || !/^[a-f0-9]{64}$/i.test(provided)) {
    return json({ error: "invalid authentication headers" }, 401);
  }
  const timestampNumber = Number(timestamp);
  const maxAge = reportMaxAgeSeconds(env);
  if (!Number.isInteger(timestampNumber) || Math.abs(now - timestampNumber) > maxAge) {
    return json({ error: "request timestamp outside allowed window", server_time: now }, 401);
  }
  if (report.generated_at > now + maxAge || report.generated_at < now - DAY_SECONDS) {
    return json({ error: "report generated_at outside allowed window", server_time: now }, 422);
  }
  let keys: Record<string, string>;
  try {
    keys = parseNodeKeys(env.NODE_KEYS);
  } catch {
    return json({ error: "server authentication configuration invalid" }, 503);
  }
  const secret = keys[report.node_id];
  if (!secret) return json({ error: "unknown node" }, 401);
  const expected = await hmacHex(secret, canonicalMessage(timestamp, nonce, body));
  if (!constantTimeEqual(expected.toLowerCase(), provided.toLowerCase())) {
    return json({ error: "invalid signature" }, 401);
  }
  return { nonce };
}

async function loadLegacyReportMetadata(
  env: Env,
  nodeId: string,
): Promise<LegacyReportMetadata | null> {
  const node = await env.DB.prepare(
    "SELECT node_id, display_name, short_mark, role_label, group_name, region_label, stale_seconds, " +
      "display_order, color_key, offline_severity, ip_change_severity FROM node_catalog " +
      "WHERE node_id = ? AND enabled = 1",
  )
    .bind(nodeId)
    .first<{
      node_id: string;
      display_name: string;
      short_mark: string;
      role_label: string;
      group_name: string;
      region_label: string;
      stale_seconds: number;
      display_order: number;
      color_key: string;
      offline_severity: Severity;
      ip_change_severity: Severity;
    }>();
  if (!node) return null;
  const [services, probes] = await Promise.all([
    env.DB.prepare(
      "SELECT service_name AS name, display_name AS label, severity FROM service_catalog " +
        "WHERE node_id = ? AND enabled = 1 ORDER BY display_order, service_name",
    )
      .bind(nodeId)
      .all<{ name: string; label: string; severity: Severity }>(),
    env.DB.prepare(
      "SELECT probe_name AS name, display_name AS label, category, target_node_id, " +
        "COALESCE(warning_ms, 0) AS warning_ms, COALESCE(critical_ms, 0) AS critical_ms, " +
        "warning_failure_percent, critical_failure_percent, severity, " +
        "display_order, is_primary FROM probe_catalog WHERE node_id = ? AND enabled = 1 " +
        "ORDER BY display_order, probe_name",
    )
      .bind(nodeId)
      .all<{
        name: string;
        label: string;
        category: string;
        target_node_id: string | null;
        warning_ms: number;
        critical_ms: number;
        warning_failure_percent: number;
        critical_failure_percent: number;
        severity: Severity;
        display_order: number;
        is_primary: number;
      }>(),
  ]);
  return {
    node: {
      id: node.node_id,
      display_name: node.display_name,
      short_mark: node.short_mark,
      role: node.role_label,
      group: node.group_name,
      region: node.region_label,
      stale_seconds: node.stale_seconds,
      display_order: node.display_order,
      color: node.color_key,
      offline_severity: node.offline_severity,
      ip_change_severity: node.ip_change_severity,
    },
    services: services.results,
    probes: probes.results.map((probe) => ({
      name: probe.name,
      label: probe.label,
      category: probe.category,
      target_node_id: probe.target_node_id ?? undefined,
      warning_ms: probe.warning_ms,
      critical_ms: probe.critical_ms,
      warning_failure_percent: probe.warning_failure_percent,
      critical_failure_percent: probe.critical_failure_percent,
      severity: probe.severity,
      display_order: probe.display_order,
      primary: probe.is_primary === 1,
    })),
  };
}

function metadataFromReport(report: AgentReport): LegacyReportMetadata {
  return {
    node: report.node,
    services: report.services.map(({ name, label, severity }) => ({ name, label, severity })),
    probes: report.probes.map((probe) => ({
      name: probe.name,
      label: probe.label,
      category: probe.category,
      target_node_id: probe.target_node_id,
      warning_ms: probe.warning_ms,
      critical_ms: probe.critical_ms,
      warning_failure_percent: probe.warning_failure_percent,
      critical_failure_percent: probe.critical_failure_percent,
      severity: probe.severity,
      display_order: probe.display_order,
      primary: probe.primary === true,
    })),
  };
}

function catalogStatements(env: Env, report: AgentReport, now: number): D1PreparedStatement[] {
  const node = report.node;
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      "INSERT INTO node_catalog(" +
        "node_id, public_id, display_name, short_mark, role_label, group_name, region_label, stale_seconds, " +
        "display_order, color_key, offline_severity, ip_change_severity, enabled, updated_at" +
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?) " +
        "ON CONFLICT(node_id) DO UPDATE SET display_name=excluded.display_name, " +
        "short_mark=excluded.short_mark, role_label=excluded.role_label, group_name=excluded.group_name, " +
        "region_label=excluded.region_label, stale_seconds=excluded.stale_seconds, display_order=excluded.display_order, " +
        "color_key=excluded.color_key, offline_severity=excluded.offline_severity, " +
        "ip_change_severity=excluded.ip_change_severity, enabled=1, updated_at=excluded.updated_at " +
        "WHERE node_catalog.display_name IS NOT excluded.display_name " +
        "OR node_catalog.short_mark IS NOT excluded.short_mark " +
        "OR node_catalog.role_label IS NOT excluded.role_label " +
        "OR node_catalog.group_name IS NOT excluded.group_name " +
        "OR node_catalog.region_label IS NOT excluded.region_label " +
        "OR node_catalog.stale_seconds IS NOT excluded.stale_seconds " +
        "OR node_catalog.display_order IS NOT excluded.display_order " +
        "OR node_catalog.color_key IS NOT excluded.color_key " +
        "OR node_catalog.offline_severity IS NOT excluded.offline_severity " +
        "OR node_catalog.ip_change_severity IS NOT excluded.ip_change_severity " +
        "OR node_catalog.enabled IS NOT 1",
    ).bind(
      node.id,
      node.id,
      node.display_name,
      node.short_mark,
      node.role,
      node.group,
      node.region,
      node.stale_seconds,
      node.display_order,
      node.color,
      node.offline_severity,
      node.ip_change_severity,
      now,
    ),
  ];
  report.services.forEach((service, index) => {
    statements.push(
      env.DB.prepare(
        "INSERT INTO service_catalog(node_id, service_name, display_name, severity, display_order, enabled, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, 1, ?) ON CONFLICT(node_id, service_name) DO UPDATE SET " +
          "display_name=excluded.display_name, severity=excluded.severity, display_order=excluded.display_order, " +
          "enabled=1, updated_at=excluded.updated_at " +
          "WHERE service_catalog.display_name IS NOT excluded.display_name " +
          "OR service_catalog.severity IS NOT excluded.severity " +
          "OR service_catalog.display_order IS NOT excluded.display_order " +
          "OR service_catalog.enabled IS NOT 1",
      ).bind(node.id, service.name, service.label, service.severity, (index + 1) * 10, now),
    );
  });
  const serviceNames = report.services.map((service) => service.name);
  const servicePlaceholders = serviceNames.map(() => "?").join(", ");
  statements.push(
    env.DB.prepare(
      "UPDATE service_catalog SET enabled = 0, updated_at = ? WHERE node_id = ? AND enabled = 1" +
        (serviceNames.length > 0 ? ` AND service_name NOT IN (${servicePlaceholders})` : ""),
    ).bind(now, node.id, ...serviceNames),
  );

  const activeRouteKeys: string[] = [];
  for (const probe of report.probes) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO probe_catalog(" +
          "node_id, probe_name, public_id, display_name, category, kind, target_node_id, warning_ms, critical_ms, " +
          "warning_failure_percent, critical_failure_percent, severity, display_order, is_primary, enabled, updated_at" +
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?) " +
          "ON CONFLICT(node_id, probe_name) DO UPDATE SET " +
          "display_name=excluded.display_name, category=excluded.category, kind=excluded.kind, " +
          "target_node_id=excluded.target_node_id, warning_ms=excluded.warning_ms, critical_ms=excluded.critical_ms, " +
          "warning_failure_percent=excluded.warning_failure_percent, " +
          "critical_failure_percent=excluded.critical_failure_percent, severity=excluded.severity, " +
          "display_order=excluded.display_order, is_primary=excluded.is_primary, enabled=1, updated_at=excluded.updated_at " +
          "WHERE probe_catalog.display_name IS NOT excluded.display_name " +
          "OR probe_catalog.category IS NOT excluded.category " +
          "OR probe_catalog.kind IS NOT excluded.kind " +
          "OR probe_catalog.target_node_id IS NOT excluded.target_node_id " +
          "OR probe_catalog.warning_ms IS NOT excluded.warning_ms " +
          "OR probe_catalog.critical_ms IS NOT excluded.critical_ms " +
          "OR probe_catalog.warning_failure_percent IS NOT excluded.warning_failure_percent " +
          "OR probe_catalog.critical_failure_percent IS NOT excluded.critical_failure_percent " +
          "OR probe_catalog.severity IS NOT excluded.severity " +
          "OR probe_catalog.display_order IS NOT excluded.display_order " +
          "OR probe_catalog.is_primary IS NOT excluded.is_primary " +
          "OR probe_catalog.enabled IS NOT 1",
      ).bind(
        node.id,
        probe.name,
        probe.name,
        probe.label,
        probe.category,
        probe.kind,
        probe.target_node_id ?? null,
        probe.warning_ms || null,
        probe.critical_ms || null,
        probe.warning_failure_percent,
        probe.critical_failure_percent,
        probe.severity,
        probe.display_order,
        probe.primary ? 1 : 0,
        now,
      ),
    );
    if (probe.category === "node-link" && probe.target_node_id) {
      const routeKey = `${node.id}--${probe.name}`;
      activeRouteKeys.push(routeKey);
      const warning = probe.warning_ms > 0 ? probe.warning_ms : 1000;
      const critical = probe.critical_ms > 0 ? Math.max(probe.critical_ms, warning) : Math.max(3000, warning);
      statements.push(
        env.DB.prepare(
          "INSERT INTO business_routes(" +
            "route_key, display_name, source_node_id, target_node_id, probe_name, target_label, warning_ms, " +
            "critical_ms, display_order, enabled, updated_at" +
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT(route_key) DO UPDATE SET " +
            "display_name=excluded.display_name, source_node_id=excluded.source_node_id, " +
            "target_node_id=excluded.target_node_id, probe_name=excluded.probe_name, target_label=excluded.target_label, " +
            "warning_ms=excluded.warning_ms, critical_ms=excluded.critical_ms, display_order=excluded.display_order, " +
            "enabled=1, updated_at=excluded.updated_at " +
            "WHERE business_routes.display_name IS NOT excluded.display_name " +
            "OR business_routes.source_node_id IS NOT excluded.source_node_id " +
            "OR business_routes.target_node_id IS NOT excluded.target_node_id " +
            "OR business_routes.probe_name IS NOT excluded.probe_name " +
            "OR business_routes.target_label IS NOT excluded.target_label " +
            "OR business_routes.warning_ms IS NOT excluded.warning_ms " +
            "OR business_routes.critical_ms IS NOT excluded.critical_ms " +
            "OR business_routes.display_order IS NOT excluded.display_order " +
            "OR business_routes.enabled IS NOT 1",
        ).bind(
          routeKey,
          probe.label,
          node.id,
          probe.target_node_id,
          probe.name,
          probe.target_node_id,
          warning,
          critical,
          probe.display_order,
          now,
        ),
      );
    }
  }
  const probeNames = report.probes.map((probe) => probe.name);
  const probePlaceholders = probeNames.map(() => "?").join(", ");
  statements.push(
    env.DB.prepare(
      "UPDATE probe_catalog SET enabled = 0, updated_at = ? WHERE node_id = ? AND enabled = 1" +
        (probeNames.length > 0 ? ` AND probe_name NOT IN (${probePlaceholders})` : ""),
    ).bind(now, node.id, ...probeNames),
  );
  for (const counter of report.counters) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO counter_catalog(" +
          "node_id, counter_name, public_id, display_name, kind, unit, display_order, enabled, updated_at" +
          ") VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT(node_id, counter_name) DO UPDATE SET " +
          "display_name=excluded.display_name, kind=excluded.kind, unit=excluded.unit, " +
          "display_order=excluded.display_order, enabled=1, updated_at=excluded.updated_at " +
          "WHERE counter_catalog.display_name IS NOT excluded.display_name " +
          "OR counter_catalog.kind IS NOT excluded.kind " +
          "OR counter_catalog.unit IS NOT excluded.unit " +
          "OR counter_catalog.display_order IS NOT excluded.display_order " +
          "OR counter_catalog.enabled IS NOT 1",
      ).bind(
        node.id,
        counter.name,
        counter.name,
        counter.label,
        counter.kind,
        counter.unit,
        counter.display_order,
        now,
      ),
    );
  }
  const counterNames = report.counters.map((counter) => counter.name);
  const counterPlaceholders = counterNames.map(() => "?").join(", ");
  statements.push(
    env.DB.prepare(
      "UPDATE counter_catalog SET enabled = 0, updated_at = ? WHERE node_id = ? AND enabled = 1" +
        (counterNames.length > 0 ? ` AND counter_name NOT IN (${counterPlaceholders})` : ""),
    ).bind(now, node.id, ...counterNames),
  );
  const routePlaceholders = activeRouteKeys.map(() => "?").join(", ");
  statements.push(
    env.DB.prepare(
      "UPDATE business_routes SET enabled = 0, updated_at = ? WHERE source_node_id = ? AND enabled = 1" +
        (activeRouteKeys.length > 0 ? ` AND route_key NOT IN (${routePlaceholders})` : ""),
    ).bind(now, node.id, ...activeRouteKeys),
  );
  return statements;
}

async function handleReport(request: Request, env: Env): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) return json({ error: "report too large" }, 413);
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return json({ error: "report too large" }, 413);
  let rawReport: unknown;
  let envelope: ReportEnvelope;
  try {
    rawReport = JSON.parse(body);
    envelope = validateReportEnvelope(rawReport);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "invalid report" }, 422);
  }
  const now = nowSeconds();
  const authentication = await authenticateReport(request, body, envelope, env, now);
  if (authentication instanceof Response) return authentication;

  let report: AgentReport;
  let legacyMetadata: LegacyReportMetadata | null = null;
  try {
    if (envelope.schema_version === 2) {
      report = validateReport(rawReport);
    } else {
      legacyMetadata = await loadLegacyReportMetadata(env, envelope.node_id);
      if (!legacyMetadata) throw new Error("legacy node metadata is unavailable");
      report = validateLegacyReport(rawReport, legacyMetadata);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "invalid report" }, 422);
  }

  const source = sourceIdentity(request);
  const prior = await env.DB.prepare(
    "SELECT approved_ip, source_ip, reported_at, last_boot_id, report_json, recent_nonces_json " +
      "FROM node_latest WHERE node_id = ?",
  )
    .bind(report.node_id)
    .first<{
      approved_ip: string | null;
      source_ip: string | null;
      reported_at: number;
      last_boot_id: string | null;
      report_json: string;
      recent_nonces_json: string;
    }>();
  const recentNoncesJson = nextRecentNonces(
    prior?.recent_nonces_json,
    authentication.nonce,
    now,
    reportMaxAgeSeconds(env),
  );
  if (recentNoncesJson === null) return json({ error: "replayed request" }, 409);
  const approvedIp = prior?.approved_ip ?? source.ip;
  let previousReport: AgentReport | null = null;
  try {
    if (prior?.report_json) {
      const previousRaw = JSON.parse(prior.report_json) as unknown;
      const previousEnvelope = validateReportEnvelope(previousRaw);
      previousReport = previousEnvelope.schema_version === 2
        ? validateReport(previousRaw)
        : validateLegacyReport(previousRaw, legacyMetadata ?? metadataFromReport(report));
    }
  } catch {
    previousReport = null;
  }
  const networkRates = computeNetworkRates(report, previousReport);
  const currentProbeRoundAt = report.probes.reduce((latest, probe) => Math.max(latest, probe.checked_at), 0);
  const previousProbeRoundAt = previousReport?.probes.reduce(
    (latest, probe) => Math.max(latest, probe.checked_at),
    0,
  ) ?? 0;
  const normalized = JSON.stringify(report);
  const statements = [
    ...catalogStatements(env, report, now),
    env.DB.prepare(
      "INSERT INTO node_latest(node_id, received_at, reported_at, source_ip, source_asn, source_org, source_country, " +
        "source_colo, approved_ip, last_boot_id, report_json, recent_nonces_json, network_rx_rate_bps, network_tx_rate_bps) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(node_id) DO UPDATE SET received_at=excluded.received_at, reported_at=excluded.reported_at, " +
        "source_ip=excluded.source_ip, source_asn=excluded.source_asn, source_org=excluded.source_org, source_country=excluded.source_country, " +
        "source_colo=excluded.source_colo, approved_ip=COALESCE(node_latest.approved_ip, excluded.approved_ip), " +
        "last_boot_id=excluded.last_boot_id, report_json=excluded.report_json, recent_nonces_json=excluded.recent_nonces_json, " +
        "network_rx_rate_bps=excluded.network_rx_rate_bps, network_tx_rate_bps=excluded.network_tx_rate_bps " +
        "WHERE excluded.reported_at >= node_latest.reported_at",
    ).bind(
      report.node_id,
      now,
      report.generated_at,
      source.ip,
      source.asn,
      source.org,
      source.country,
      source.colo,
      approvedIp,
      report.system.boot_id,
      normalized,
      recentNoncesJson,
      networkRates.rxBps,
      networkRates.txBps,
    ),
    metricSampleStatement(env, report, now, networkRates),
  ];
  if (report.probes.length > 0 && currentProbeRoundAt > previousProbeRoundAt) {
    statements.push(probeRoundStatement(env, report.node_id, report.probes, now));
  }
  if (source.ip && (!prior || prior.source_ip !== source.ip)) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO ip_history(node_id, observed_at, ip, asn, org, country, approved) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(report.node_id, now, source.ip, source.asn, source.org, source.country, !prior ? 1 : 0),
    );
  }
  if (prior && report.generated_at > prior.reported_at) {
    const observedAt = report.generated_at;
    const addEvent = (
      eventType: string,
      severity: Severity,
      title: string,
      detail: string,
      discriminator: string,
    ): void => {
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO observability_events(" +
            "node_id, event_type, severity, occurred_at, title, detail, dedup_key" +
            ") VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          report.node_id,
          eventType,
          severity,
          observedAt,
          title,
          detail,
          `${report.node_id}:${eventType}:${observedAt}:${discriminator}`,
        ),
      );
    };
    if (prior.last_boot_id && prior.last_boot_id !== report.system.boot_id) {
      addEvent("reboot", "INFO", "系统重新启动", "检测到 boot ID 变化", report.system.boot_id);
    }
    if (previousReport && previousReport.agent_version !== report.agent_version) {
      addEvent(
        "agent_version",
        "INFO",
        "Agent 版本变化",
        `${previousReport.agent_version} → ${report.agent_version}`,
        report.agent_version,
      );
    }
    if (previousReport && previousReport.agent.started_at !== report.agent.started_at) {
      addEvent("agent_restart", "INFO", "Agent 重新启动", "Agent 启动时间发生变化", String(report.agent.started_at));
    }
    if (previousReport) {
      const previousServices = new Map(previousReport.services.map((service) => [service.name, service]));
      for (const service of report.services) {
        const oldState = previousServices.get(service.name)?.state ?? "unknown";
        if (oldState !== service.state) {
          addEvent(
            "service_state",
            service.state === "active" ? "INFO" : service.severity,
            `${service.label} 状态变化`,
            `${oldState} → ${service.state}`,
            `${service.name}:${service.state}`,
          );
        }
      }
    }
    if (prior.source_ip && source.ip && prior.source_ip !== source.ip) {
      addEvent(
        "source_ip",
        report.node.ip_change_severity,
        "上报源地址变化",
        `${maskIp(prior.source_ip)} → ${maskIp(source.ip)}`,
        maskIp(source.ip),
      );
    }
  }
  await env.DB.batch(statements);
  return json({ ok: true, server_time: now, accepted_node: report.node_id }, 202);
}

async function telegramStatusMessage(env: Env, now: number): Promise<string> {
  const [catalog, nodes] = await Promise.all([
    loadDashboardCatalog(env),
    env.DB.prepare(
      "SELECT node_id, received_at, report_json FROM node_latest ORDER BY node_id",
    ).all<TelegramStatusNodeRow>(),
  ]);
  return formatTelegramStatusMessage(catalog.nodes, nodes.results, now);
}

function telegramHelpMessage(): string {
  return [
    "🤖 VPS 监控机器人命令",
    "",
    "/status — 查看实时状态",
    "/panel — 打开监控面板",
    "/help — 查看命令说明",
    "",
    "仅响应已绑定账号的私聊；命令通过 Webhook 实时处理，通常数秒内返回。",
    "面板登录链接 5 分钟内有效且只能使用一次，登录状态保持 30 天。",
    "采集始终在后台持续运行；机器人不会主动发送告警或日报。",
  ].join("\n");
}

async function telegramCommandMessage(env: Env, command: TelegramCommand, now: number): Promise<string> {
  if (command === "status") return telegramStatusMessage(env, now);
  if (command === "help") return telegramHelpMessage();
  const token = await issueDashboardLogin(env, now);
  const baseUrl = env.DASHBOARD_BASE_URL.replace(/\/+$/, "");
  return [
    "🔐 VPS 监控面板登录",
    "",
    `${baseUrl}/auth/telegram?token=${encodeURIComponent(token)}`,
    "",
    "此链接 5 分钟内有效且只能使用一次。登录后浏览器保持 30 天；请勿转发链接。",
  ].join("\n");
}

async function cleanup(env: Env, now: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM snapshots WHERE received_at < ?").bind(now - 30 * DAY_SECONDS),
    env.DB.prepare("DELETE FROM metric_rollups WHERE bucket < ?").bind(now - 30 * DAY_SECONDS),
    env.DB.prepare("DELETE FROM probe_rollups WHERE bucket < ?").bind(now - 30 * DAY_SECONDS),
    env.DB.prepare("DELETE FROM probe_sample_dedup WHERE ingested_at < ?").bind(now - 30 * DAY_SECONDS),
    env.DB.prepare("DELETE FROM metric_samples_v2 WHERE received_at < ?").bind(now - 30 * DAY_SECONDS),
    env.DB.prepare("DELETE FROM probe_samples_v2 WHERE received_at < ?").bind(now - 30 * DAY_SECONDS),
    env.DB.prepare("DELETE FROM metric_samples_v3 WHERE received_at < ?").bind(now - 30 * DAY_SECONDS),
    env.DB.prepare("DELETE FROM probe_rounds_v3 WHERE received_at < ?").bind(now - 30 * DAY_SECONDS),
    env.DB.prepare("DELETE FROM metric_series_rollups WHERE resolution = 'hour' AND bucket < ?").bind(now - 400 * DAY_SECONDS),
    env.DB.prepare("DELETE FROM probe_series_rollups WHERE resolution = 'hour' AND bucket < ?").bind(now - 400 * DAY_SECONDS),
    env.DB.prepare("DELETE FROM metric_series_rollups WHERE resolution = 'day' AND bucket < ?").bind(now - 730 * DAY_SECONDS),
    env.DB.prepare("DELETE FROM probe_series_rollups WHERE resolution = 'day' AND bucket < ?").bind(now - 730 * DAY_SECONDS),
    env.DB.prepare("DELETE FROM observability_events WHERE occurred_at < ?").bind(now - 365 * DAY_SECONDS),
    env.DB.prepare("DELETE FROM alert_events WHERE created_at < ?").bind(now - 365 * DAY_SECONDS),
    env.DB.prepare("DELETE FROM settings WHERE key LIKE 'telegram_webhook_update:%' AND updated_at < ?").bind(now - DAY_SECONDS),
  ]);
  await cleanupDashboardAuth(env, now);
}

function isAdmin(request: Request, env: Env): boolean {
  if (!env.ADMIN_TOKEN) return false;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return constantTimeEqual(supplied, env.ADMIN_TOKEN);
}

async function status(env: Env, now: number): Promise<Response> {
  const nodes = await env.DB.prepare(
    "SELECT latest.node_id, catalog.display_name, latest.received_at, latest.reported_at, latest.source_ip, " +
      "latest.source_asn, latest.source_org, latest.source_country, latest.source_colo, latest.report_json " +
      "FROM node_latest AS latest LEFT JOIN node_catalog AS catalog ON catalog.node_id = latest.node_id " +
      "ORDER BY catalog.display_order, latest.node_id",
  ).all<Record<string, unknown>>();
  return json({
    server_time: now,
    nodes: nodes.results.map((node) => {
      return {
        ...node,
        source_ip: maskIp((node.source_ip as string | null) ?? null),
      };
    }),
    alerts: [],
  });
}

async function dashboardAuthorized(request: Request, env: Env, now: number): Promise<boolean> {
  return isAdmin(request, env) || hasDashboardSession(request, env, now);
}

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({
    location,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

async function handleDashboardLogin(requestUrl: URL, env: Env, now: number): Promise<Response> {
  const token = (requestUrl.searchParams.get("token") ?? "").slice(0, 128);
  if (!(await consumeDashboardLogin(env, token, now))) return redirect("/dashboard/?login=expired");
  return redirect("/dashboard/", await newDashboardSessionCookie(env, now));
}

function secureAssetResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  if ((headers.get("content-type") ?? "").includes("text/html")) headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
  const now = Math.floor(controller.scheduledTime / 1000);
  try {
    await ensureTelegramWebhook(env, now);
  } catch {
    // Retried by the next scheduled run; never expose the token or webhook secret in logs.
  }
  try {
    await ensureTelegramCommandMenu(env, now);
  } catch {
    // Retried by the next scheduled run; command delivery uses the webhook independently.
  }
  if (new Date(now * 1000).getUTCMinutes() === 7) {
    try {
      await compactRecentObservability(env, now);
    } catch {
      // The next hourly pass rebuilds an overlapping three-hour window.
    }
  }
  if (controller.cron === "0 1 * * *") {
    try {
      await compactRecentObservability(env, now, true);
    } catch {
      // Dashboard raw samples remain available even if a rollup pass is retried later.
    }
    await cleanup(env, now);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") {
      return json({ ok: true, version: env.APP_VERSION });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/canary") {
      const nonce = (url.searchParams.get("nonce") ?? "").slice(0, 128);
      const probeId = (url.searchParams.get("probe_id") ?? "").slice(0, 128);
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(nonce) || !/^[A-Za-z0-9_-]{1,128}$/.test(probeId)) {
        return json({ error: "invalid canary parameters" }, 400);
      }
      return json({ ok: true, nonce, probe_id: probeId, observed: sourceIdentity(request), server_time: nowSeconds() });
    }
    if (request.method === "POST" && url.pathname === "/api/v1/report") {
      return handleReport(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/telegram/webhook") {
      if (!env.TELEGRAM_WEBHOOK_SECRET || env.TELEGRAM_WEBHOOK_SECRET.length < 32) {
        return json({ error: "webhook unavailable" }, 503);
      }
      const supplied = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
      if (!constantTimeEqual(supplied, env.TELEGRAM_WEBHOOK_SECRET)) {
        return json({ error: "unauthorized" }, 401);
      }
      const contentLength = Number(request.headers.get("content-length") ?? "0");
      if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
        return json({ error: "payload too large" }, 413);
      }
      let update: TelegramUpdate;
      try {
        const body = await request.text();
        if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
          return json({ error: "payload too large" }, 413);
        }
        const parsed = JSON.parse(body) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return json({ error: "invalid update" }, 400);
        }
        update = parsed as TelegramUpdate;
      } catch {
        return json({ error: "invalid JSON" }, 400);
      }
      try {
        const result = await processTelegramWebhookUpdate(
          env,
          update,
          nowSeconds(),
          (command) => telegramCommandMessage(env, command, nowSeconds()),
        );
        return json({ ok: true, result });
      } catch {
        return json({ error: "telegram processing failed" }, 502);
      }
    }
    if (request.method === "GET" && url.pathname === "/auth/telegram") {
      try {
        return await handleDashboardLogin(url, env, nowSeconds());
      } catch {
        return redirect("/dashboard/?login=error");
      }
    }
    if (request.method === "POST" && url.pathname === "/auth/logout") {
      return new Response(null, {
        status: 204,
        headers: {
          "set-cookie": clearDashboardSessionCookie(),
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/dashboard/latest") {
      const now = nowSeconds();
      if (!(await dashboardAuthorized(request, env, now))) return json({ error: "unauthorized" }, 401);
      try {
        return json(await latestDashboardData(env, now));
      } catch {
        return json({ error: "dashboard data unavailable" }, 503);
      }
    }
    if (request.method === "GET" && url.pathname === "/api/v1/dashboard/history") {
      const now = nowSeconds();
      if (!(await dashboardAuthorized(request, env, now))) return json({ error: "unauthorized" }, 401);
      try {
        return json(
          await dashboardHistoryData(
            env,
            now,
            normalizeHistoryHours(url.searchParams.get("hours")),
            url.searchParams.get("node"),
          ),
        );
      } catch {
        return json({ error: "dashboard history unavailable" }, 503);
      }
    }
    if (request.method === "GET" && url.pathname === "/api/v1/status") {
      return isAdmin(request, env) ? status(env, nowSeconds()) : json({ error: "unauthorized" }, 401);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/admin/rebuild-observability") {
      if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
      const offsetDays = Number(url.searchParams.get("offset_days") ?? "0");
      if (!Number.isInteger(offsetDays) || offsetDays < 0 || offsetDays > 730) {
        return json({ error: "offset_days must be an integer from 0 to 730" }, 400);
      }
      try {
        return json({ ok: true, offset_days: offsetDays, ...(await rebuildObservabilityDay(env, nowSeconds(), offsetDays)) });
      } catch {
        return json({ error: "observability rebuild failed" }, 500);
      }
    }
    if (request.method === "GET" && url.pathname === "/api/v1/admin/telegram-diagnostics") {
      if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
      try {
        return json(await telegramDiagnostics(env));
      } catch {
        return json({ error: "telegram diagnostics failed" }, 502);
      }
    }
    if (request.method === "POST" && url.pathname === "/api/v1/admin/configure-telegram-webhook") {
      const suppliedWebhookSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
      const webhookAuthorized = Boolean(
        env.TELEGRAM_WEBHOOK_SECRET &&
          env.TELEGRAM_WEBHOOK_SECRET.length >= 32 &&
          constantTimeEqual(suppliedWebhookSecret, env.TELEGRAM_WEBHOOK_SECRET),
      );
      if (!isAdmin(request, env) && !webhookAuthorized) return json({ error: "unauthorized" }, 401);
      try {
        return json({ ok: await configureTelegramWebhook(env, nowSeconds()) });
      } catch {
        return json({ error: "telegram webhook configuration failed" }, 502);
      }
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/dashboard")) {
      return redirect("/dashboard/");
    }
    if ((request.method === "GET" || request.method === "HEAD") && env.ASSETS) {
      return secureAssetResponse(await env.ASSETS.fetch(request));
    }
    return json({ error: "not found" }, 404);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(scheduled(controller, env));
  },
} satisfies ExportedHandler<Env>;
