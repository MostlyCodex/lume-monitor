import type {
  AgentReport,
  NodeMetadata,
  ProbeResult,
  ServiceStatus,
  Severity,
  SystemMetrics,
} from "./types";

export interface ReportEnvelope {
  schema_version: 1 | 2;
  node_id: string;
  generated_at: number;
}

export interface LegacyReportMetadata {
  node: NodeMetadata;
  services: Array<{ name: string; label: string; severity: Severity }>;
  probes: Array<{
    name: string;
    label: string;
    category: string;
    target_node_id?: string;
    warning_ms: number;
    critical_ms: number;
    warning_failure_percent?: number;
    critical_failure_percent?: number;
    severity: Severity;
    display_order: number;
    primary: boolean;
  }>;
}

const NODE_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const SERVICE_NAME = /^[A-Za-z0-9_.@-]{1,80}$/;
const PROBE_NAME = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const CATEGORY = /^[a-z][a-z0-9_-]{0,31}$/;
const COLOR = /^[a-z][a-z0-9_-]{0,23}$/;

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, name: string, max = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || /[\r\n\t]/.test(value)) {
    throw new Error(`${name} must be a non-empty string up to ${max} characters`);
  }
  return value;
}

function patternValue(value: unknown, name: string, pattern: RegExp, max: number): string {
  const result = stringValue(value, name, max);
  if (!pattern.test(result)) throw new Error(`${name} has an invalid format`);
  return result;
}

function numberValue(value: unknown, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

function optionalNumber(value: unknown, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return value === undefined ? 0 : numberValue(value, name, min, max);
}

function integerValue(value: unknown, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const result = numberValue(value, name, min, max);
  if (!Number.isInteger(result)) throw new Error(`${name} must be an integer`);
  return result;
}

function severityValue(value: unknown, name: string): Severity {
  const result = stringValue(value, name, 4);
  if (result !== "P1" && result !== "P2" && result !== "INFO") throw new Error(`${name} is invalid`);
  return result;
}

function nodeMetadata(value: unknown, expectedId: string): NodeMetadata {
  const v = record(value, "node");
  const id = patternValue(v.id, "node.id", NODE_ID, 32);
  if (id !== expectedId) throw new Error("node.id must match node_id");
  const mark = stringValue(v.short_mark, "node.short_mark", 4);
  if (!/^[A-Za-z0-9]{1,4}$/.test(mark)) throw new Error("node.short_mark has an invalid format");
  return {
    id,
    display_name: stringValue(v.display_name, "node.display_name", 80),
    short_mark: mark,
    role: stringValue(v.role, "node.role", 80),
    group: stringValue(v.group, "node.group", 80),
    region: stringValue(v.region, "node.region", 80),
    stale_seconds: integerValue(v.stale_seconds, "node.stale_seconds", 60, 3600),
    display_order: integerValue(v.display_order, "node.display_order", 1, 10000),
    color: patternValue(v.color, "node.color", COLOR, 24),
    offline_severity: severityValue(v.offline_severity, "node.offline_severity"),
    ip_change_severity: severityValue(v.ip_change_severity, "node.ip_change_severity"),
  };
}

function systemMetrics(value: unknown): SystemMetrics {
  const v = record(value, "system");
  return {
    hostname: stringValue(v.hostname, "system.hostname", 128),
    os: stringValue(v.os, "system.os", 256),
    kernel: stringValue(v.kernel, "system.kernel", 128),
    arch: stringValue(v.arch, "system.arch", 32),
    boot_id: stringValue(v.boot_id, "system.boot_id", 128),
    uptime_seconds: numberValue(v.uptime_seconds, "system.uptime_seconds"),
    cpu_percent: numberValue(v.cpu_percent, "system.cpu_percent", 0, 100),
    load1: numberValue(v.load1, "system.load1", 0, 100000),
    load5: numberValue(v.load5, "system.load5", 0, 100000),
    load15: numberValue(v.load15, "system.load15", 0, 100000),
    memory_total_bytes: integerValue(v.memory_total_bytes, "system.memory_total_bytes"),
    memory_available_bytes: integerValue(v.memory_available_bytes, "system.memory_available_bytes"),
    swap_total_bytes: integerValue(v.swap_total_bytes, "system.swap_total_bytes"),
    swap_used_bytes: integerValue(v.swap_used_bytes, "system.swap_used_bytes"),
    root_total_bytes: integerValue(v.root_total_bytes, "system.root_total_bytes"),
    root_free_bytes: integerValue(v.root_free_bytes, "system.root_free_bytes"),
    root_used_percent: numberValue(v.root_used_percent, "system.root_used_percent", 0, 100),
    root_inode_used_percent: numberValue(v.root_inode_used_percent, "system.root_inode_used_percent", 0, 100),
    network_rx_bytes: integerValue(v.network_rx_bytes, "system.network_rx_bytes"),
    network_tx_bytes: integerValue(v.network_tx_bytes, "system.network_tx_bytes"),
    network_rx_errors: integerValue(v.network_rx_errors, "system.network_rx_errors"),
    network_tx_errors: integerValue(v.network_tx_errors, "system.network_tx_errors"),
    network_rx_drops: integerValue(v.network_rx_drops, "system.network_rx_drops"),
    network_tx_drops: integerValue(v.network_tx_drops, "system.network_tx_drops"),
  };
}

function services(value: unknown): ServiceStatus[] {
  if (!Array.isArray(value) || value.length > 16) throw new Error("services must be an array up to 16 entries");
  const names = new Set<string>();
  return value.map((entry, index) => {
    const v = record(entry, `services[${index}]`);
    const name = patternValue(v.name, `services[${index}].name`, SERVICE_NAME, 80);
    if (names.has(name)) throw new Error("service names must be unique");
    names.add(name);
    return {
      name,
      label: stringValue(v.label, `services[${index}].label`, 80),
      severity: severityValue(v.severity, `services[${index}].severity`),
      state: stringValue(v.state, `services[${index}].state`, 32),
    };
  });
}

function probes(value: unknown): ProbeResult[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error("probes must be an array up to 32 entries");
  const names = new Set<string>();
  return value.map((entry, index) => {
    const v = record(entry, `probes[${index}]`);
    const name = patternValue(v.name, `probes[${index}].name`, PROBE_NAME, 80);
    if (names.has(name)) throw new Error("probe names must be unique");
    names.add(name);
    const kind = stringValue(v.kind, `probes[${index}].kind`, 16);
    if (kind !== "icmp") throw new Error("probe kind must be icmp");
    if (typeof v.success !== "boolean") throw new Error(`probes[${index}].success must be boolean`);
    if (v.primary !== undefined && typeof v.primary !== "boolean") throw new Error(`probes[${index}].primary must be boolean`);
    const warning = optionalNumber(v.warning_ms, `probes[${index}].warning_ms`, 0, 120000);
    const critical = optionalNumber(v.critical_ms, `probes[${index}].critical_ms`, 0, 120000);
    if (warning > 0 && critical > 0 && warning > critical) throw new Error("probe latency thresholds are invalid");
    const warningFailure = optionalNumber(
      v.warning_failure_percent,
      `probes[${index}].warning_failure_percent`,
      0,
      100,
    );
    const criticalFailure = optionalNumber(
      v.critical_failure_percent,
      `probes[${index}].critical_failure_percent`,
      0,
      100,
    );
    if (warningFailure > 0 && criticalFailure > 0 && warningFailure > criticalFailure) {
      throw new Error("probe failure-rate thresholds are invalid");
    }
    const sampleCount = v.samples === undefined ? 5 : integerValue(v.samples, `probes[${index}].samples`, 1, 10);
    const attemptedSamples = v.attempted_samples === undefined
      ? sampleCount
      : integerValue(v.attempted_samples, `probes[${index}].attempted_samples`, 0, sampleCount);
    const successfulSamples = v.successful_samples === undefined
      ? (v.success ? attemptedSamples : 0)
      : integerValue(v.successful_samples, `probes[${index}].successful_samples`, 0, attemptedSamples);
    const complete = v.complete === undefined ? attemptedSamples === sampleCount : v.complete;
    if (typeof complete !== "boolean" || complete !== (attemptedSamples === sampleCount)) {
      throw new Error(`probes[${index}].complete is inconsistent with attempted samples`);
    }
    const derivedSuccess = complete && successfulSamples > sampleCount / 2;
    if (v.success !== derivedSuccess) {
      throw new Error(`probes[${index}].success is inconsistent with sample counts`);
    }
    const derivedFailure = attemptedSamples > 0
      ? 100 * (attemptedSamples - successfulSamples) / attemptedSamples
      : 100;
    const sampleFailure = v.sample_failure_percent === undefined
      ? derivedFailure
      : numberValue(v.sample_failure_percent, `probes[${index}].sample_failure_percent`, 0, 100);
    if (Math.abs(sampleFailure - derivedFailure) > 0.011) {
      throw new Error(`probes[${index}].sample_failure_percent is inconsistent with sample counts`);
    }
    const packetLoss = v.packet_loss_percent === undefined
      ? sampleFailure
      : numberValue(v.packet_loss_percent, `probes[${index}].packet_loss_percent`, 0, 100);
    if (Math.abs(packetLoss - sampleFailure) > 0.011) {
      throw new Error(`probes[${index}].packet_loss_percent is inconsistent with ICMP samples`);
    }
    const result: ProbeResult = {
      name,
      label: stringValue(v.label, `probes[${index}].label`, 80),
      category: patternValue(v.category, `probes[${index}].category`, CATEGORY, 32),
      kind,
      target: stringValue(v.target, `probes[${index}].target`, 256),
      warning_ms: warning,
      critical_ms: critical,
      warning_failure_percent: warningFailure,
      critical_failure_percent: criticalFailure,
      severity: severityValue(v.severity, `probes[${index}].severity`),
      display_order: integerValue(v.display_order, `probes[${index}].display_order`, 1, 10000),
      primary: v.primary === true,
      success: v.success,
      complete,
      duration_ms: numberValue(v.duration_ms, `probes[${index}].duration_ms`, 0, 120000),
      samples: sampleCount,
      attempted_samples: attemptedSamples,
      successful_samples: successfulSamples,
      sample_failure_percent: sampleFailure,
      checked_at: integerValue(v.checked_at, `probes[${index}].checked_at`, 1),
    };
    result.packet_loss_percent = packetLoss;
    if (v.target_node_id !== undefined) {
      result.target_node_id = patternValue(v.target_node_id, `probes[${index}].target_node_id`, NODE_ID, 32);
    }
    if (result.category === "node-link" && !result.target_node_id) {
      throw new Error(`probes[${index}].target_node_id is required for node-link probes`);
    }
    if (v.min_duration_ms !== undefined) result.min_duration_ms = numberValue(v.min_duration_ms, `probes[${index}].min_duration_ms`, 0, 120000);
    if (v.max_duration_ms !== undefined) result.max_duration_ms = numberValue(v.max_duration_ms, `probes[${index}].max_duration_ms`, 0, 120000);
    if (v.average_duration_ms !== undefined) result.average_duration_ms = numberValue(v.average_duration_ms, `probes[${index}].average_duration_ms`, 0, 120000);
    if (v.p95_duration_ms !== undefined) result.p95_duration_ms = numberValue(v.p95_duration_ms, `probes[${index}].p95_duration_ms`, 0, 120000);
    if (v.range_ms !== undefined) result.range_ms = numberValue(v.range_ms, `probes[${index}].range_ms`, 0, 120000);
    if (v.jitter_ms !== undefined) result.jitter_ms = numberValue(v.jitter_ms, `probes[${index}].jitter_ms`, 0, 120000);
    if (v.remote_ip !== undefined) result.remote_ip = stringValue(v.remote_ip, `probes[${index}].remote_ip`, 64);
    if (v.error !== undefined) result.error = cleanDiagnostic(stringValue(v.error, `probes[${index}].error`, 160));
    return result;
  });
}

export function validateReportEnvelope(value: unknown): ReportEnvelope {
  const v = record(value, "report");
  if (v.schema_version !== 1 && v.schema_version !== 2) throw new Error("unsupported schema_version");
  return {
    schema_version: v.schema_version,
    node_id: patternValue(v.node_id, "node_id", NODE_ID, 32),
    generated_at: integerValue(v.generated_at, "generated_at", 1),
  };
}

export function validateLegacyReport(value: unknown, metadata: LegacyReportMetadata): AgentReport {
  const v = record(value, "report");
  const envelope = validateReportEnvelope(v);
  if (envelope.schema_version !== 1) throw new Error("legacy report must use schema_version 1");
  const node = nodeMetadata(metadata.node, envelope.node_id);
  const serviceMetadata = new Map(metadata.services.map((entry) => [entry.name, entry]));
  const probeMetadata = new Map(metadata.probes.map((entry) => [entry.name, entry]));
  if (!Array.isArray(v.services) || v.services.length > 16) throw new Error("services must be an array up to 16 entries");
  if (!Array.isArray(v.probes) || v.probes.length > 32) throw new Error("probes must be an array up to 32 entries");

  const legacyServices = v.services.map((entry, index) => {
    const item = record(entry, `services[${index}]`);
    const name = patternValue(item.name, `services[${index}].name`, SERVICE_NAME, 80);
    const meta = serviceMetadata.get(name);
    return {
      name,
      label: stringValue(meta?.label ?? name, `services[${index}].label`, 80),
      severity: severityValue(meta?.severity ?? "P1", `services[${index}].severity`),
      state: stringValue(item.state, `services[${index}].state`, 32),
    };
  });

  const enrichedProbes = v.probes.map((entry, index) => {
    const item = record(entry, `probes[${index}]`);
    const name = patternValue(item.name, `probes[${index}].name`, PROBE_NAME, 80);
    const meta = probeMetadata.get(name);
    if (!meta) throw new Error(`legacy probe metadata is missing for ${name}`);
    return {
      ...item,
      name,
      label: meta.label,
      category: meta.target_node_id ? "node-link" : meta.category,
      target_node_id: meta.target_node_id,
      warning_ms: meta.warning_ms,
      critical_ms: meta.critical_ms,
      warning_failure_percent: meta.warning_failure_percent,
      critical_failure_percent: meta.critical_failure_percent,
      severity: meta.severity,
      display_order: meta.display_order,
      primary: meta.primary,
    };
  });
  const agent = record(v.agent, "agent");

  return {
    schema_version: 2,
    agent_version: stringValue(v.agent_version, "agent_version", 64),
    node_id: envelope.node_id,
    node,
    generated_at: envelope.generated_at,
    system: systemMetrics(v.system),
    services: legacyServices,
    probes: probes(enrichedProbes),
    agent: {
      queue_depth: integerValue(agent.queue_depth, "agent.queue_depth", 0, 10000),
      collect_errors: integerValue(agent.collect_errors, "agent.collect_errors"),
      send_errors: integerValue(agent.send_errors, "agent.send_errors"),
      started_at: integerValue(agent.started_at, "agent.started_at", 1),
    },
  };
}

export function validateReport(value: unknown): AgentReport {
  const v = record(value, "report");
  const envelope = validateReportEnvelope(v);
  if (envelope.schema_version !== 2) throw new Error("unsupported schema_version");
  const nodeId = envelope.node_id;
  const agent = record(v.agent, "agent");
  return {
    schema_version: 2,
    agent_version: stringValue(v.agent_version, "agent_version", 64),
    node_id: nodeId,
    node: nodeMetadata(v.node, nodeId),
    generated_at: envelope.generated_at,
    system: systemMetrics(v.system),
    services: services(v.services),
    probes: probes(v.probes),
    agent: {
      queue_depth: integerValue(agent.queue_depth, "agent.queue_depth", 0, 10000),
      collect_errors: integerValue(agent.collect_errors, "agent.collect_errors"),
      send_errors: integerValue(agent.send_errors, "agent.send_errors"),
      started_at: integerValue(agent.started_at, "agent.started_at", 1),
    },
  };
}

export function cleanDiagnostic(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").slice(0, 160);
}
