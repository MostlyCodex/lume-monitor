import type {
  AgentReport,
  NodeMetadata,
  ProbeResult,
  ServiceStatus,
  Severity,
  SystemMetrics,
} from "./types";

export interface ReportEnvelope {
  schema_version: 2;
  node_id: string;
  generated_at: number;
}

const NODE_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const SERVICE_NAME = /^[A-Za-z0-9_.@-]{1,80}$/;
const PROBE_NAME = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const CATEGORY = /^[a-z][a-z0-9_-]{0,31}$/;

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

// Reports are read field by field: only the values the dashboard and Telegram
// use are kept, and anything else a report carries is dropped here.
function nodeMetadata(value: unknown, expectedId: string): NodeMetadata {
  const v = record(value, "node");
  const id = patternValue(v.id, "node.id", NODE_ID, 32);
  if (id !== expectedId) throw new Error("node.id must match node_id");
  return {
    id,
    display_name: stringValue(v.display_name, "node.display_name", 80),
    role: stringValue(v.role, "node.role", 80),
    region: stringValue(v.region, "node.region", 80),
    stale_seconds: integerValue(v.stale_seconds, "node.stale_seconds", 60, 3600),
    display_order: integerValue(v.display_order, "node.display_order", 1, 10000),
    ip_change_severity: severityValue(v.ip_change_severity, "node.ip_change_severity"),
  };
}

function networkFields(v: Record<string, unknown>): Partial<SystemMetrics> {
  const result: Partial<SystemMetrics> = {};
  if (v.network_valid !== undefined) {
    if (typeof v.network_valid !== "boolean") throw new Error("system.network_valid must be a boolean");
    result.network_valid = v.network_valid;
  }
  if (v.network_interfaces !== undefined) {
    if (!Array.isArray(v.network_interfaces) || v.network_interfaces.length > 16) {
      throw new Error("system.network_interfaces must be an array up to 16 entries");
    }
    const names = v.network_interfaces.map((name) =>
      patternValue(name, "network interface", /^(?!lo$|\.{1,2}$)[A-Za-z0-9_.:-]{1,15}$/, 15),
    );
    if (new Set(names).size !== names.length) throw new Error("network interfaces must be unique");
    result.network_interfaces = names.sort();
  }
  if (v.network_scope !== undefined) {
    result.network_scope = patternValue(v.network_scope, "system.network_scope", /^[a-f0-9]{64}$/, 64);
  }
  if (result.network_valid === true && (!result.network_interfaces?.length || !result.network_scope)) {
    throw new Error("valid network metrics require interface identities");
  }
  if (v.traffic_cycle !== undefined) {
    if (result.network_valid !== true) throw new Error("traffic cycle requires valid network metrics");
    const cycle = record(v.traffic_cycle, "system.traffic_cycle");
    result.traffic_cycle = {
      rx_bytes: integerValue(cycle.rx_bytes, "traffic cycle RX"),
      tx_bytes: integerValue(cycle.tx_bytes, "traffic cycle TX"),
    };
  }
  return result;
}

function systemMetrics(value: unknown): SystemMetrics {
  const v = record(value, "system");
  return {
    ...networkFields(v),
    hostname: stringValue(v.hostname, "system.hostname", 128),
    os: stringValue(v.os, "system.os", 256),
    kernel: stringValue(v.kernel, "system.kernel", 128),
    boot_id: stringValue(v.boot_id, "system.boot_id", 128),
    uptime_seconds: numberValue(v.uptime_seconds, "system.uptime_seconds"),
    cpu_percent: numberValue(v.cpu_percent, "system.cpu_percent", 0, 100),
    cpu_count: v.cpu_count === undefined ? undefined : integerValue(v.cpu_count, "system.cpu_count", 1, 65536),
    memory_total_bytes: integerValue(v.memory_total_bytes, "system.memory_total_bytes"),
    memory_available_bytes: integerValue(v.memory_available_bytes, "system.memory_available_bytes"),
    root_total_bytes: integerValue(v.root_total_bytes, "system.root_total_bytes"),
    root_used_percent: numberValue(v.root_used_percent, "system.root_used_percent", 0, 100),
    network_rx_bytes: integerValue(v.network_rx_bytes, "system.network_rx_bytes"),
    network_tx_bytes: integerValue(v.network_tx_bytes, "system.network_tx_bytes"),
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
    if (kind !== "icmp" && kind !== "tcp") throw new Error("probe kind must be icmp or tcp");
    if (typeof v.success !== "boolean") throw new Error(`probes[${index}].success must be boolean`);
    const warning = optionalNumber(v.warning_ms, `probes[${index}].warning_ms`, 0, 120000);
    const critical = optionalNumber(v.critical_ms, `probes[${index}].critical_ms`, 0, 120000);
    if (warning > 0 && critical > 0 && warning > critical) throw new Error("probe latency thresholds are invalid");
    // Packet-loss thresholds only exist for ICMP; TCP rounds report latency and reachability.
    const warningLoss = kind === "icmp"
      ? optionalNumber(v.warning_failure_percent, `probes[${index}].warning_failure_percent`, 0, 100)
      : 0;
    const criticalLoss = kind === "icmp"
      ? optionalNumber(v.critical_failure_percent, `probes[${index}].critical_failure_percent`, 0, 100)
      : 0;
    if (warningLoss > 0 && criticalLoss > 0 && warningLoss > criticalLoss) {
      throw new Error("probe packet-loss thresholds are invalid");
    }
    const sampleCount = integerValue(v.samples, `probes[${index}].samples`, 1, 10);
    const attemptedSamples = integerValue(v.attempted_samples, `probes[${index}].attempted_samples`, 0, sampleCount);
    const successfulSamples = integerValue(
      v.successful_samples,
      `probes[${index}].successful_samples`,
      0,
      attemptedSamples,
    );
    const complete = attemptedSamples === sampleCount;
    if (v.complete !== complete) throw new Error(`probes[${index}].complete is inconsistent with attempted samples`);
    if (v.success !== (complete && successfulSamples > sampleCount / 2)) {
      throw new Error(`probes[${index}].success is inconsistent with sample counts`);
    }
    const result: ProbeResult = {
      name,
      label: stringValue(v.label, `probes[${index}].label`, 80),
      category: patternValue(v.category, `probes[${index}].category`, CATEGORY, 32),
      kind,
      warning_ms: warning,
      critical_ms: critical,
      warning_failure_percent: warningLoss,
      critical_failure_percent: criticalLoss,
      severity: severityValue(v.severity, `probes[${index}].severity`),
      display_order: integerValue(v.display_order, `probes[${index}].display_order`, 1, 10000),
      success: v.success,
      complete,
      duration_ms: numberValue(v.duration_ms, `probes[${index}].duration_ms`, 0, 120000),
      samples: sampleCount,
      attempted_samples: attemptedSamples,
      successful_samples: successfulSamples,
      checked_at: integerValue(v.checked_at, `probes[${index}].checked_at`, 1),
    };
    if (v.target_node_id !== undefined) {
      result.target_node_id = patternValue(v.target_node_id, `probes[${index}].target_node_id`, NODE_ID, 32);
    }
    if (result.category === "node-link" && !result.target_node_id) {
      throw new Error(`probes[${index}].target_node_id is required for node-link probes`);
    }
    return result;
  });
}

/** ICMP packet loss of one round, derived from its sample counts. */
export function packetLossPercent(probe: ProbeResult): number | null {
  if (probe.kind !== "icmp") return null;
  return probe.attempted_samples > 0
    ? (100 * (probe.attempted_samples - probe.successful_samples)) / probe.attempted_samples
    : 100;
}

export function validateReportEnvelope(value: unknown): ReportEnvelope {
  const v = record(value, "report");
  if (v.schema_version !== 2) throw new Error("unsupported schema_version");
  return {
    schema_version: v.schema_version,
    node_id: patternValue(v.node_id, "node_id", NODE_ID, 32),
    generated_at: integerValue(v.generated_at, "generated_at", 1),
  };
}

export function validateReport(value: unknown): AgentReport {
  const v = record(value, "report");
  const envelope = validateReportEnvelope(v);
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
      config_fingerprint: agent.config_fingerprint === undefined
        ? undefined
        : patternValue(agent.config_fingerprint, "agent.config_fingerprint", /^[a-f0-9]{64}$/, 64),
      started_at: integerValue(agent.started_at, "agent.started_at", 1),
    },
  };
}
