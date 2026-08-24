(() => {
  "use strict";

  const ENERGY_SLOTS = 18;
  const ENERGY_WINDOW_HOURS = 24;
  const ENERGY_LOSS_WARNING_PERCENT = 2;
  const ENERGY_LOSS_CRITICAL_PERCENT = 10;
  const ENERGY_LOSS_BURST_PERCENT = 60;
  const PROBE_COLOR_VARIABLES = Object.freeze({
    telecom: "--probe-telecom",
    unicom: "--probe-unicom",
    mobile: "--probe-mobile",
    link: "--probe-link",
    green: "--green",
    red: "--red",
  });
  const PROBE_COLOR_TONES = Object.freeze(Object.keys(PROBE_COLOR_VARIABLES));
  const FLAG_ART = Object.freeze({
    US: `<svg viewBox="0 0 36 24" aria-hidden="true" focusable="false"><rect width="36" height="24" fill="#fff"/><path fill="#b22234" d="M0 0h36v1.85H0zm0 3.69h36v1.85H0zm0 3.69h36v1.85H0zm0 3.69h36v1.85H0zm0 3.7h36v1.84H0zm0 3.69h36v1.85H0zm0 3.69h36V24H0z"/><path fill="#3c3b6e" d="M0 0h15.5v12.92H0z"/><g fill="#fff"><circle cx="2" cy="2" r=".55"/><circle cx="5" cy="2" r=".55"/><circle cx="8" cy="2" r=".55"/><circle cx="11" cy="2" r=".55"/><circle cx="14" cy="2" r=".55"/><circle cx="3.5" cy="4.2" r=".55"/><circle cx="6.5" cy="4.2" r=".55"/><circle cx="9.5" cy="4.2" r=".55"/><circle cx="12.5" cy="4.2" r=".55"/><circle cx="2" cy="6.4" r=".55"/><circle cx="5" cy="6.4" r=".55"/><circle cx="8" cy="6.4" r=".55"/><circle cx="11" cy="6.4" r=".55"/><circle cx="14" cy="6.4" r=".55"/><circle cx="3.5" cy="8.6" r=".55"/><circle cx="6.5" cy="8.6" r=".55"/><circle cx="9.5" cy="8.6" r=".55"/><circle cx="12.5" cy="8.6" r=".55"/><circle cx="2" cy="10.8" r=".55"/><circle cx="5" cy="10.8" r=".55"/><circle cx="8" cy="10.8" r=".55"/><circle cx="11" cy="10.8" r=".55"/><circle cx="14" cy="10.8" r=".55"/></g></svg>`,
    SG: `<svg viewBox="0 0 36 24" aria-hidden="true" focusable="false"><rect width="36" height="24" fill="#fff"/><rect width="36" height="12" fill="#ef3340"/><path fill="#fff" fill-rule="evenodd" d="M9.5 2.05a4.95 4.95 0 1 0 0 7.9 4.15 4.15 0 1 1 0-7.9Z"/><g fill="#fff"><circle cx="11.6" cy="3" r=".65"/><circle cx="13.6" cy="4.4" r=".65"/><circle cx="12.85" cy="6.75" r=".65"/><circle cx="10.35" cy="6.75" r=".65"/><circle cx="9.6" cy="4.4" r=".65"/></g></svg>`,
  });
  const severityRank = { healthy: 0, warning: 1, critical: 2, offline: 3 };
  const DASHBOARD_LAYOUT_KEY = "vpsmon-dashboard-layout-v1";
  const LEGACY_DEFAULT_BRANDS = new Set(["Wesley VPS Monitor"]);
  const DEFAULT_DASHBOARD_LAYOUT = Object.freeze({
    brand: "远山Monitor",
    order: [],
    nodes: {},
  });
  const state = {
    latest: null,
    fleetHistory: null,
    detailHistory: null,
    detailHistoryCache: new Map(),
    detailHistoryRequests: new Map(),
    selectedNode: null,
    detailProbeSelection: new Set(),
    detailNetworkLayers: new Set(["latency", "loss"]),
    initialNode: new URLSearchParams(location.search).get("node"),
    detailHours: 24,
    search: "",
    refreshTimer: null,
    historyTimer: null,
    toastTimer: null,
    plots: new Map(),
    plotHosts: new Map(),
    resizeObserver: null,
    layout: null,
    settingsDraftOrder: [],
  };

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  class AuthError extends Error {}

  function readPreference(key, fallback = null) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }

  function writePreference(key, value) {
    try { localStorage.setItem(key, value); } catch { /* Preferences are optional. */ }
  }

  function removePreference(key) {
    try { localStorage.removeItem(key); } catch { /* Preferences are optional. */ }
  }

  function layoutText(value, maximum, fallback = "") {
    if (typeof value !== "string") return fallback;
    const normalized = value.trim().slice(0, maximum);
    return normalized || fallback;
  }

  function normalizeDashboardLayout(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const nodes = {};
    if (source.nodes && typeof source.nodes === "object" && !Array.isArray(source.nodes)) {
      Object.entries(source.nodes).slice(0, 256).forEach(([id, entry]) => {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !entry || typeof entry !== "object" || Array.isArray(entry)) return;
        const countryValue = layoutText(entry.country, 2).toUpperCase();
        nodes[id] = {
          label: layoutText(entry.label, 64),
          role: layoutText(entry.role, 80),
          region: layoutText(entry.region, 80),
          country: /^[A-Z]{2}$/.test(countryValue) ? countryValue : "",
        };
      });
    }
    const seen = new Set();
    const order = Array.isArray(source.order)
      ? source.order.filter((id) => {
        if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
      }).slice(0, 256)
      : [];
    const configuredBrand = layoutText(source.brand, 48);
    return {
      brand: !configuredBrand || LEGACY_DEFAULT_BRANDS.has(configuredBrand) ? DEFAULT_DASHBOARD_LAYOUT.brand : configuredBrand,
      order,
      nodes,
    };
  }

  function readDashboardLayout() {
    try { return normalizeDashboardLayout(JSON.parse(readPreference(DASHBOARD_LAYOUT_KEY, "{}"))); }
    catch { return normalizeDashboardLayout({}); }
  }

  async function fetchJson(url) {
    const response = await fetch(url, { credentials: "same-origin", headers: { accept: "application/json" } });
    if (response.status === 401) throw new AuthError("authentication required");
    if (!response.ok) throw new Error(`request failed: ${response.status}`);
    return response.json();
  }

  function detailHistoryKey(nodeId, hours) {
    return `${nodeId}:${hours}`;
  }

  function fleetHistoryPreview(nodeId, hours) {
    const history = state.fleetHistory;
    if (!history || hours > 24) return null;
    const since = Number(history.server_time || 0) - hours * 3600;
    return {
      ...history,
      hours,
      selected_node: nodeId,
      metrics: (history.metrics || []).filter((row) => row.node_id === nodeId && Number(row.timestamp) >= since),
      probes: (history.probes || []).filter((row) => row.node_id === nodeId && Number(row.timestamp) >= since),
      probe_summaries: [],
      annotations: (history.annotations || []).filter((event) => event.node_id === nodeId && Number(event.timestamp) >= since),
    };
  }

  function availableDetailHistory(nodeId, hours) {
    return state.detailHistoryCache.get(detailHistoryKey(nodeId, hours)) || fleetHistoryPreview(nodeId, hours);
  }

  function setView(name) {
    $("loading-view").classList.toggle("is-hidden", name !== "loading");
    $("auth-view").classList.toggle("is-hidden", name !== "auth");
    $("dashboard-view").classList.toggle("is-hidden", name !== "dashboard");
  }

  function showAuth() {
    stopTimers();
    destroyPlots();
    const parameter = new URLSearchParams(location.search).get("login");
    const message = $("login-message");
    if (parameter === "expired") {
      message.textContent = "登录链接已过期或已使用，请重新发送 /panel。";
      message.classList.remove("is-hidden");
    } else if (parameter === "error") {
      message.textContent = "登录暂时未完成，请重新获取一次性链接。";
      message.classList.remove("is-hidden");
    } else {
      message.classList.add("is-hidden");
    }
    setView("auth");
  }

  function showToast(message, error = false) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.toggle("is-error", error);
    toast.classList.remove("is-hidden");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.add("is-hidden"), 3200);
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number(value) || 0));
  }

  function formatPercent(value, digits = 1) {
    const numeric = clamp(value, 0, 100);
    return `${numeric.toFixed(digits)}%`;
  }

  function formatLoss(value) {
    const numeric = clamp(value, 0, 100);
    return `${Number.isInteger(numeric) ? numeric.toFixed(0) : numeric.toFixed(1)}%`;
  }

  function formatAge(seconds) {
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    if (value < 60) return `${value} 秒前`;
    if (value < 3600) return `${Math.floor(value / 60)} 分钟前`;
    if (value < 86400) return `${Math.floor(value / 3600)} 小时前`;
    return `${Math.floor(value / 86400)} 天前`;
  }

  function formatInterval(seconds) {
    const value = Math.max(1, Math.round(Number(seconds) || 0));
    if (value % 3600 === 0) return `${value / 3600} 小时`;
    if (value % 60 === 0) return `${value / 60} 分钟`;
    return `${value} 秒`;
  }

  function formatUptime(seconds) {
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    const days = Math.floor(value / 86400);
    const hours = Math.floor((value % 86400) / 3600);
    if (days > 0) return `${days} 天 ${hours} 小时`;
    return `${hours} 小时 ${Math.floor((value % 3600) / 60)} 分`;
  }

  function formatBytes(value) {
    let bytes = Math.max(0, Number(value) || 0);
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    let index = 0;
    while (bytes >= 1024 && index < units.length - 1) { bytes /= 1024; index += 1; }
    return `${bytes.toFixed(index > 2 ? 2 : 1)} ${units[index]}`;
  }

  function formatRate(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
    return `${formatBytes(value)}/s`;
  }

  function formatTime(timestamp, includeDate = false) {
    if (!timestamp) return "—";
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: includeDate ? "2-digit" : undefined,
      day: includeDate ? "2-digit" : undefined,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(Number(timestamp) * 1000));
  }

  function formatAxisTime(timestamp, hours) {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: hours > 24 ? "2-digit" : undefined,
      day: hours > 24 ? "2-digit" : undefined,
      hour: hours <= 720 ? "2-digit" : undefined,
      minute: hours <= 24 ? "2-digit" : undefined,
      hour12: false,
    }).format(new Date(Number(timestamp) * 1000));
  }

  function cssColor(variable) {
    return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  }

  function colorWithAlpha(color, alpha) {
    const value = String(color || "").trim();
    const opacity = clamp(alpha, 0, 1);
    const hex = value.match(/^#([\da-f]{6})$/i);
    if (hex) {
      const numeric = Number.parseInt(hex[1], 16);
      return `rgba(${numeric >> 16}, ${(numeric >> 8) & 255}, ${numeric & 255}, ${opacity})`;
    }
    const rgb = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${opacity})`;
    return value;
  }

  function catalogNodes() {
    const preferred = new Map((state.layout?.order || []).map((id, index) => [id, index]));
    return [...(state.latest?.catalog?.nodes || [])].sort((left, right) => {
      const leftRank = preferred.has(left.id) ? preferred.get(left.id) : Number.MAX_SAFE_INTEGER;
      const rightRank = preferred.has(right.id) ? preferred.get(right.id) : Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      const orderDelta = Number(left.order) - Number(right.order);
      return orderDelta || String(left.label || left.id).localeCompare(String(right.label || right.id), "zh-CN");
    });
  }

  function rawNode(id) {
    return state.latest?.nodes?.find((node) => node.id === id) || null;
  }

  function applyNodeLayout(node) {
    if (!node) return null;
    const override = state.layout?.nodes?.[node.id] || {};
    return {
      ...node,
      label: override.label || node.label,
      role: override.role || node.role,
      region: override.region || node.region,
      country: override.country || node.country,
    };
  }

  function getNode(id) {
    return applyNodeLayout(rawNode(id));
  }

  function nodeFromCatalog(meta) {
    return getNode(meta.id) || applyNodeLayout({ ...meta, online: false, data_error: true, metrics: {}, probes: [], services: [] });
  }

  function displayProbeLabel(value) {
    const label = typeof value === "string" ? value : value?.label;
    return String(label || "网络目标").replace(/\s*·\s*ICMP\s*$/i, "").trim();
  }

  function displayProbes(node) {
    return (node?.probes || [])
      .sort((left, right) => {
        const categoryDelta = Number(left.category === "node-link") - Number(right.category === "node-link");
        return categoryDelta || Number(left.order || 999) - Number(right.order || 999);
      })
      .slice(0, 4);
  }

  function serviceStateText(value) {
    if (value === "active") return "运行正常";
    if (value === "activating") return "启动中";
    if (value === "deactivating") return "停止中";
    if (value === "inactive") return "未运行";
    if (value === "failed") return "运行故障";
    return "状态未知";
  }

  function serviceDisplayLabel(entry) {
    return String(entry?.label || entry?.name || "服务").replace(/\s*状态\s*$/u, "").trim() || "服务";
  }

  function serviceSummary(node) {
    const services = Array.isArray(node?.services) ? node.services : [];
    if (!services.length) return { label: "基础监测", text: "Agent 正常", severity: "neutral" };
    const unhealthy = services.find((service) => service.state !== "active");
    if (services.length === 1) {
      return {
        label: services[0].label || services[0].name || "服务",
        text: serviceStateText(services[0].state),
        severity: services[0].state === "active" ? "healthy" : services[0].state === "failed" ? "critical" : "warning",
      };
    }
    return {
      label: "服务状态",
      text: unhealthy ? `${unhealthy.label || unhealthy.name} · ${serviceStateText(unhealthy.state)}` : `${services.length} 项均正常`,
      severity: unhealthy ? (unhealthy.state === "failed" ? "critical" : "warning") : "healthy",
    };
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function historicalRows(nodeId, probeName, history = state.fleetHistory) {
    return (history?.probes || [])
      .filter((row) => row.node_id === nodeId && row.probe_name === probeName)
      .sort((left, right) => Number(left.timestamp) - Number(right.timestamp));
  }

  function probeThresholds(probe, rows = []) {
    const baseline = median(rows.map((row) => Number(row.latency_ms)).filter(Number.isFinite));
    const warningMs = Number(probe?.warning_ms) > 0 ? Number(probe.warning_ms) : baseline ? baseline * 1.35 : Number.POSITIVE_INFINITY;
    const criticalMs = Number(probe?.critical_ms) > 0 ? Number(probe.critical_ms) : baseline ? baseline * 1.7 : Number.POSITIVE_INFINITY;
    const warningLoss = Number(probe?.warning_failure_percent) > 0 ? Number(probe.warning_failure_percent) : 1;
    const criticalLoss = Number(probe?.critical_failure_percent) > 0 ? Number(probe.critical_failure_percent) : 5;
    return { warningMs, criticalMs, warningLoss, criticalLoss };
  }

  function probeMetricSeverity(metric, value, probe, rows = [], success = true, complete = true) {
    if (!success || complete === false) return "critical";
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "healthy";
    const thresholds = probeThresholds(probe, rows);
    const warning = metric === "latency" ? thresholds.warningMs : thresholds.warningLoss;
    const critical = metric === "latency" ? thresholds.criticalMs : thresholds.criticalLoss;
    if (numeric >= critical) return "critical";
    if (numeric >= warning) return "warning";
    return "healthy";
  }

  function energyLossSeverity(lossPercent, worstFiveMinuteLossPercent = 0) {
    const loss = Number(lossPercent);
    const worstFiveMinuteLoss = Number(worstFiveMinuteLossPercent);
    if (!Number.isFinite(loss)) return "healthy";
    if ((Number.isFinite(worstFiveMinuteLoss) && worstFiveMinuteLoss >= ENERGY_LOSS_BURST_PERCENT) ||
        loss > ENERGY_LOSS_CRITICAL_PERCENT) return "critical";
    if (loss > ENERGY_LOSS_WARNING_PERCENT) return "warning";
    return "healthy";
  }

  function measurementSeverity({ latency, loss, success = true, complete = true }, probe, rows = []) {
    if (!success || complete === false) return "critical";
    return [
      probeMetricSeverity("latency", latency, probe, rows),
      probeMetricSeverity("loss", loss, probe, rows),
    ].reduce((worst, current) =>
      severityRank[current] > severityRank[worst] ? current : worst, "healthy");
  }

  function currentProbeSeverity(probe, nodeId) {
    const rows = historicalRows(nodeId, probe.name);
    return measurementSeverity({
      latency: probe.duration_ms,
      loss: probe.packet_loss_percent ?? probe.sample_failure_percent,
      success: probe.success,
      complete: probe.complete,
    }, probe, rows);
  }

  function nodeSeverity(node) {
    if (!node?.online || node.data_error) return "offline";
    const service = serviceSummary(node).severity;
    const probeSeverities = displayProbes(node).map((probe) => currentProbeSeverity(probe, node.id));
    return [service, ...probeSeverities].reduce((worst, current) =>
      (severityRank[current] || 0) > (severityRank[worst] || 0) ? current : worst, "healthy");
  }

  function severityLabel(severity) {
    if (severity === "offline") return "上报中断";
    if (severity === "critical") return "异常";
    if (severity === "warning") return "需关注";
    return "正常";
  }

  function nodeKind(node) {
    const role = String(node?.role || "").toLocaleLowerCase("zh-CN");
    const serviceLabels = (node?.services || []).map((service) => `${service.label || ""} ${service.name || ""}`).join(" ").toLowerCase();
    const transit = role.includes("中转") || serviceLabels.includes("nftables");
    const egress = role.includes("落地") || serviceLabels.includes("xray");
    return { transit, egress };
  }

  function flagIcon(country) {
    const code = String(country || "").trim().toUpperCase();
    const art = FLAG_ART[code];
    if (art) return art;
    return `<span class="flag-fallback" aria-hidden="true">${escapeHtml(/^[A-Z]{2}$/.test(code) ? code : "◇")}</span>`;
  }

  function resourceSeverity(value, warning, critical) {
    const numeric = clamp(value, 0, 100);
    if (numeric >= critical) return "critical";
    if (numeric >= warning) return "warning";
    return "healthy";
  }

  function resourceGauge(shortLabel, label, value, warning = 70, critical = 85) {
    const numeric = clamp(value, 0, 100);
    const severity = resourceSeverity(numeric, warning, critical);
    const level = numeric.toFixed(1);
    const gap = (100.1 - numeric).toFixed(1);
    const fill = numeric <= 0.05 ? "" : `<line class="resource-gauge-fill" x1="0" y1="6.5" x2="100%" y2="6.5" pathLength="100" stroke-dasharray="${level} ${gap}"></line>`;
    const marker = numeric <= 0.05 ? "" : `<circle class="resource-gauge-marker" cx="${level}%" cy="6.5" r="4.5"></circle>`;
    return `<div class="resource-gauge is-${severity}" role="progressbar" aria-label="${escapeHtml(label)} ${numeric.toFixed(1)}%" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${numeric.toFixed(1)}">
      <div class="resource-gauge-head">
        <strong>${escapeHtml(shortLabel)}</strong>
        <span>${numeric.toFixed(0)}%</span>
      </div>
      <svg class="resource-gauge-track" aria-hidden="true" focusable="false">
        <line class="resource-gauge-base" x1="0" y1="6.5" x2="100%" y2="6.5" pathLength="100"></line>
        ${fill}
        <line class="resource-threshold resource-threshold-warning" x1="70%" y1="1" x2="70%" y2="12"></line>
        <line class="resource-threshold resource-threshold-critical" x1="85%" y1="1" x2="85%" y2="12"></line>
        ${marker}
      </svg>
    </div>`;
  }

  function detailServiceList(node) {
    const services = Array.isArray(node?.services) ? node.services : [];
    if (!services.length) return '<div class="detail-service-list"><span class="detail-service is-healthy"><i></i><b>Agent</b><em>基础监测正常</em></span></div>';
    return `<div class="detail-service-list">${services.map((entry) => {
      const severity = entry.state === "active" ? "healthy" : entry.state === "failed" ? "critical" : "warning";
      return `<span class="detail-service is-${severity}"><i></i><b>${escapeHtml(serviceDisplayLabel(entry))}</b><em>${escapeHtml(serviceStateText(entry.state))}</em></span>`;
    }).join("")}</div>`;
  }

  function aggregateMetricEnergy(nodeId, probe, metric, history = state.fleetHistory) {
    const rows = historicalRows(nodeId, probe.name, history);
    const end = Number(history?.server_time || state.latest?.server_time || Math.floor(Date.now() / 1000));
    const start = end - ENERGY_WINDOW_HOURS * 3600;
    const slotSeconds = (end - start) / ENERGY_SLOTS;
    const thresholdsRows = rows.filter((row) => Number(row.timestamp) >= start);
    const buckets = [];
    for (let index = 0; index < ENERGY_SLOTS; index += 1) {
      const slotStart = start + index * slotSeconds;
      const slotEnd = slotStart + slotSeconds;
      const members = thresholdsRows.filter((row) => Number(row.timestamp) >= slotStart && Number(row.timestamp) < slotEnd);
      if (!members.length) {
        buckets.push({ empty: true, start: slotStart, end: slotEnd, severity: "empty" });
        continue;
      }
      if (metric === "loss") {
        const configuredSamples = Math.max(1, Number(probe?.samples) || 1);
        const totals = members.reduce((total, row) => {
          const attempted = Number(row.attempted_samples);
          const successful = Number(row.successful_samples);
          const rawLoss = Number(row.packet_loss_percent ?? row.sample_failure_percent);
          if (Number.isFinite(attempted) && attempted > 0 && Number.isFinite(successful)) {
            total.attempted += attempted;
            total.successful += clamp(successful, 0, attempted);
          } else if (Number.isFinite(rawLoss)) {
            const estimatedAttempts = Math.max(1, Number(row.rounds) || 1) * configuredSamples;
            total.attempted += estimatedAttempts;
            total.successful += estimatedAttempts * (1 - clamp(rawLoss, 0, 100) / 100);
          }
          if (Number.isFinite(rawLoss)) total.worstFiveMinuteLoss = Math.max(total.worstFiveMinuteLoss, rawLoss);
          return total;
        }, { attempted: 0, successful: 0, worstFiveMinuteLoss: 0 });
        const loss = totals.attempted
          ? 100 * (totals.attempted - totals.successful) / totals.attempted
          : null;
        buckets.push({
          empty: loss === null,
          start: slotStart,
          end: slotEnd,
          value: loss,
          attempted: totals.attempted,
          successful: totals.successful,
          severeFiveMinuteLoss: totals.worstFiveMinuteLoss >= ENERGY_LOSS_BURST_PERCENT,
          severity: energyLossSeverity(loss, totals.worstFiveMinuteLoss),
        });
        continue;
      }
      const latencyValues = members.map((row) => Number(row.latency_ms)).filter(Number.isFinite);
      const latency = latencyValues.length ? latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length : null;
      const value = latency;
      let severity = probeMetricSeverity("latency", value, probe, thresholdsRows, value !== null);
      let criticalSamples = 0;
      let warningSamples = 0;
      for (const row of members) {
        const sample = row.latency_ms;
        const rowSeverity = probeMetricSeverity(
          "latency",
          sample,
          probe,
          thresholdsRows,
          Number.isFinite(Number(sample)) && Number(row.success_percent ?? 100) > 0,
        );
        if (rowSeverity === "critical") criticalSamples += 1;
        else if (rowSeverity === "warning") warningSamples += 1;
      }
      const criticalRatio = criticalSamples / members.length;
      const warningRatio = warningSamples / members.length;
      if (severity !== "critical" && criticalRatio >= 0.25) severity = "critical";
      else if (severity === "healthy" && (criticalSamples > 0 || warningRatio >= 0.25)) severity = "warning";
      buckets.push({ empty: false, start: slotStart, end: slotEnd, value, severity });
    }
    return buckets;
  }

  function metricEnergyStrip(nodeId, probe, metric, history = state.fleetHistory) {
    const buckets = aggregateMetricEnergy(nodeId, probe, metric, history);
    const metricLabel = metric === "latency" ? "延迟" : "丢包";
    return `<div class="energy-strip is-${metric}" aria-label="${escapeHtml(displayProbeLabel(probe))} 最近 24 小时${metricLabel}">
      ${buckets.map((bucket, index) => {
        if (bucket.empty) return `<i class="energy-cell is-empty ${index === buckets.length - 1 ? "is-latest" : ""}" title="${escapeHtml(formatTime(bucket.start, true))} · 无采样"></i>`;
        const formattedValue = metric === "latency" ? `${Math.round(bucket.value || 0)} ms` : formatLoss(bucket.value);
        const sampleDetail = metric === "loss" && Number(bucket.attempted) > 0
          ? ` · 丢失 ${Math.round(Math.max(0, bucket.attempted - bucket.successful))}/${Math.round(bucket.attempted)} 包`
          : "";
        const burstDetail = metric === "loss" && bucket.severeFiveMinuteLoss ? " · 含5分钟严重丢包" : "";
        const title = `${formatTime(bucket.start, true)} · ${metricLabel} ${formattedValue}${sampleDetail}${burstDetail}`;
        return `<i class="energy-cell is-${bucket.severity} ${index === buckets.length - 1 ? "is-latest" : ""}" title="${escapeHtml(title)}"></i>`;
      }).join("")}
    </div>`;
  }

  function probeMetricCard(node, probe, metric, history = state.fleetHistory) {
    const isLatency = metric === "latency";
    const rawValue = isLatency ? probe.duration_ms : probe.packet_loss_percent ?? probe.sample_failure_percent;
    const value = isLatency
      ? (probe.success && Number.isFinite(Number(rawValue)) ? `${Math.round(Number(rawValue))} ms` : "— ms")
      : formatLoss(rawValue ?? 100);
    const severity = probeMetricSeverity(metric, rawValue, probe, historicalRows(node.id, probe.name, history), probe.success, probe.complete);
    return `<div class="probe-metric is-${metric} is-${severity}">
      <div class="probe-metric-head"><span>${isLatency ? "延迟" : "丢包"}</span><strong>${escapeHtml(value)}</strong></div>
      ${metricEnergyStrip(node.id, probe, metric, history)}
    </div>`;
  }

  function probeRow(node, probe, history = state.fleetHistory) {
    const severity = currentProbeSeverity(probe, node.id);
    return `<div class="probe-row is-${severity}">
      <div class="probe-target"><i></i><span title="${escapeHtml(displayProbeLabel(probe))}">${escapeHtml(displayProbeLabel(probe))}</span></div>
      <div class="probe-metrics">
        ${probeMetricCard(node, probe, "latency", history)}
        ${probeMetricCard(node, probe, "loss", history)}
      </div>
    </div>`;
  }

  function renderNodeCard(node) {
    const severity = nodeSeverity(node);
    if (node.data_error) {
      return `<article class="node-card is-offline" data-node="${escapeHtml(node.id)}" role="button" tabindex="0" aria-label="查看 ${escapeHtml(node.label)} 详情">
        <div class="node-card-inner"><div class="node-card-head"><div class="node-avatar">${escapeHtml(node.mark || "?")}</div><div class="node-title"><strong>${escapeHtml(node.label || "节点")}</strong><span>${escapeHtml(node.role || "等待首次上报")}</span></div><span class="node-status is-offline"><i class="node-live-dot"></i>等待上报</span></div><div class="node-card-placeholder"><div><strong>暂无有效数据</strong><p>Agent 完成首次上报后自动显示</p></div></div><div class="node-card-foot"><span>节点已注册</span><span>查看详情 →</span></div></div>
      </article>`;
    }
    const probes = displayProbes(node);
    const metrics = node.metrics || {};
    const region = [node.country, node.region].filter(Boolean).join(" · ") || "未知区域";
    return `<article class="node-card is-${severity}" data-node="${escapeHtml(node.id)}" role="button" tabindex="0" aria-label="查看 ${escapeHtml(node.label)} 详情">
      <div class="node-card-inner">
        <div class="node-card-head">
          <div class="node-flag" role="img" aria-label="${escapeHtml(node.country || "未知国家")}">${flagIcon(node.country)}</div>
          <div class="node-title"><strong>${escapeHtml(node.label)}</strong><span class="node-uptime">运行 ${escapeHtml(formatUptime(metrics.uptime_seconds))}</span></div>
          <span class="node-status is-${severity}"><i class="node-live-dot"></i>${escapeHtml(severityLabel(severity))}</span>
        </div>
        <div class="resource-gauges">
          ${resourceGauge("CPU", "处理器", metrics.cpu_percent, 70, 85)}
          ${resourceGauge("RAM", "内存", metrics.memory_used_percent, 70, 85)}
          ${resourceGauge("Disk", "磁盘", metrics.disk_used_percent, 75, 85)}
        </div>
        <div class="node-telemetry-panel">
          <div class="node-network-row"><span>↯ 网络速率</span><strong><b class="is-up">↑ ${escapeHtml(formatRate(metrics.network_tx_rate_bps))}</b><b class="is-down">↓ ${escapeHtml(formatRate(metrics.network_rx_rate_bps))}</b></strong></div>
          <div class="node-network-row"><span>累计流量</span><strong><b>↑ ${escapeHtml(formatBytes(metrics.network_tx_bytes))}</b><b>↓ ${escapeHtml(formatBytes(metrics.network_rx_bytes))}</b></strong></div>
          ${probes.length ? `<div class="probe-block"><div class="probe-block-head"><span>网络质量（24H）</span><small>${probes.length} 个目标</small></div>${probes.map((probe) => probeRow(node, probe)).join("")}</div>` : '<div class="probe-empty">此节点仅监测服务与基础资源</div>'}
        </div>
        <div class="node-card-foot"><div class="node-tags"><span>${escapeHtml(node.role || "VPS")}</span><span>${escapeHtml(region)}</span></div><span>${escapeHtml(formatAge(node.age_seconds))}更新&nbsp; →</span></div>
      </div>
    </article>`;
  }

  function filteredNodes() {
    const query = state.search.trim().toLocaleLowerCase("zh-CN");
    return catalogNodes().map(nodeFromCatalog).filter((node) => {
      return !query || [node.label, node.role, node.region, node.country]
        .some((value) => String(value || "").toLocaleLowerCase("zh-CN").includes(query));
    });
  }

  function renderNodes() {
    const nodes = filteredNodes();
    $("node-grid").innerHTML = nodes.length
      ? nodes.map(renderNodeCard).join("")
      : '<div class="empty-state"><i>◇</i><strong>没有符合条件的节点</strong><span>请调整搜索内容后重试</span></div>';
  }

  function renderSummary() {
    const nodes = catalogNodes().map(nodeFromCatalog);
    const online = nodes.filter((node) => node.online && !node.data_error).length;
    const allProbes = nodes.flatMap((node) => displayProbes(node).map((probe) => ({ node, probe })));
    const healthyProbes = allProbes.filter(({ node, probe }) => currentProbeSeverity(probe, node.id) === "healthy").length;
    const attention = nodes.filter((node) => nodeSeverity(node) !== "healthy").length;
    $("summary-strip").innerHTML = [
      ["在线节点", `${online}/${nodes.length}`, online < nodes.length ? "critical" : ""],
      ["线路正常", `${healthyProbes}/${allProbes.length}`, healthyProbes < allProbes.length ? "warning" : ""],
      ["需关注", `${attention}`, attention ? "warning" : ""],
      ["探针周期", formatInterval(state.latest?.cadence?.probes_seconds ?? 60), ""],
    ].map(([label, value, tone]) => `<div class="summary-item ${tone ? `is-${tone}` : ""}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  }

  function applyGlobalLayout() {
    const layout = state.layout || DEFAULT_DASHBOARD_LAYOUT;
    document.querySelectorAll("[data-dashboard-brand]").forEach((element) => { element.textContent = layout.brand; });
    document.title = layout.brand;
  }

  function renderHealth() {
    const nodes = catalogNodes().map(nodeFromCatalog);
    const severities = nodes.map(nodeSeverity);
    const critical = severities.some((severity) => severity === "critical" || severity === "offline");
    const warning = !critical && severities.some((severity) => severity === "warning");
    const health = $("top-health");
    health.classList.toggle("is-critical", critical);
    health.classList.toggle("is-warning", warning);
    health.querySelector("strong").textContent = critical ? "存在关键异常" : warning ? "部分线路需关注" : "所有节点运行正常";
    $("fleet-health-copy").textContent = critical ? "请进入异常节点查看" : warning ? "业务仍在运行" : `${nodes.length} 个节点持续上报`;
  }

  function renderFleet() {
    applyGlobalLayout();
    renderHealth();
    renderSummary();
    renderNodes();
    $("last-refresh").textContent = `更新于 ${formatTime(state.latest.server_time)}`;
  }

  function settingsNode(id) {
    const meta = (state.latest?.catalog?.nodes || []).find((node) => node.id === id);
    return meta ? nodeFromCatalog(meta) : null;
  }

  function renderSettingsNodeList() {
    const host = $("settings-node-list");
    host.innerHTML = state.settingsDraftOrder.map((id, index) => {
      const node = settingsNode(id);
      if (!node) return "";
      return `<article class="settings-node" data-settings-node="${escapeHtml(id)}">
        <header>
          <div><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(node.label || id)}</strong><small>${escapeHtml(id)}</small></div>
          <div class="settings-order-actions">
            <button class="icon-button" type="button" data-settings-move="-1" aria-label="上移 ${escapeHtml(node.label || id)}" ${index === 0 ? "disabled" : ""}>↑</button>
            <button class="icon-button" type="button" data-settings-move="1" aria-label="下移 ${escapeHtml(node.label || id)}" ${index === state.settingsDraftOrder.length - 1 ? "disabled" : ""}>↓</button>
          </div>
        </header>
        <div class="settings-node-grid">
          <label><span>显示名称</span><input type="text" data-settings-field="label" maxlength="64" value="${escapeHtml(node.label || "")}" autocomplete="off"></label>
          <label><span>角色标题</span><input type="text" data-settings-field="role" maxlength="80" value="${escapeHtml(node.role || "")}" autocomplete="off"></label>
          <label><span>国家代码</span><input class="settings-country" type="text" data-settings-field="country" maxlength="2" value="${escapeHtml(node.country || "")}" placeholder="US" autocomplete="off"></label>
          <label><span>城市 / 区域</span><input type="text" data-settings-field="region" maxlength="80" value="${escapeHtml(node.region || "")}" autocomplete="off"></label>
        </div>
      </article>`;
    }).join("");
  }

  function syncSettingsNodeOrder() {
    const host = $("settings-node-list");
    const rows = new Map([...host.querySelectorAll("[data-settings-node]")].map((row) => [row.dataset.settingsNode, row]));
    state.settingsDraftOrder.forEach((id, index) => {
      const row = rows.get(id);
      if (!row) return;
      host.appendChild(row);
      row.querySelector("header > div:first-child > span").textContent = String(index + 1).padStart(2, "0");
      const buttons = row.querySelectorAll("[data-settings-move]");
      buttons[0].disabled = index === 0;
      buttons[1].disabled = index === state.settingsDraftOrder.length - 1;
    });
  }

  function openSettings() {
    if (!state.latest) return;
    state.settingsDraftOrder = catalogNodes().map((node) => node.id);
    $("settings-brand").value = state.layout?.brand || DEFAULT_DASHBOARD_LAYOUT.brand;
    renderSettingsNodeList();
    $("settings-dialog").showModal();
  }

  function closeSettings() {
    if ($("settings-dialog").open) $("settings-dialog").close();
  }

  function saveSettings(event) {
    event.preventDefault();
    const nodes = {};
    document.querySelectorAll("[data-settings-node]").forEach((row) => {
      const id = row.dataset.settingsNode;
      const value = (field) => row.querySelector(`[data-settings-field="${field}"]`)?.value || "";
      nodes[id] = {
        label: value("label"),
        role: value("role"),
        country: value("country"),
        region: value("region"),
      };
    });
    state.layout = normalizeDashboardLayout({
      brand: $("settings-brand").value,
      order: state.settingsDraftOrder,
      nodes,
    });
    writePreference(DASHBOARD_LAYOUT_KEY, JSON.stringify(state.layout));
    closeSettings();
    renderFleet();
    if (state.selectedNode) renderDetail();
    showToast("面板显示设置已保存到当前浏览器");
  }

  function resetSettings() {
    removePreference(DASHBOARD_LAYOUT_KEY);
    state.layout = normalizeDashboardLayout({});
    state.settingsDraftOrder = [];
    closeSettings();
    renderFleet();
    if (state.selectedNode) renderDetail();
    showToast("已恢复默认显示");
  }

  function detailFact(label, value) {
    return `<div class="detail-fact"><span>${escapeHtml(label)}</span><strong title="${escapeHtml(value)}">${escapeHtml(value)}</strong></div>`;
  }

  function renderDetailHero() {
    const node = getNode(state.selectedNode);
    if (!node) return;
    const severity = nodeSeverity(node);
    const metrics = node.metrics || {};
    $("detail-hero").innerHTML = `<div class="detail-identity"><div class="detail-flag" role="img" aria-label="${escapeHtml(node.country || "未知国家")}">${flagIcon(node.country)}</div><div><p class="eyebrow">${escapeHtml(node.role || "VPS NODE")}</p><h1>${escapeHtml(node.label)}</h1><p>${escapeHtml([node.region, node.country, `更新于 ${formatTime(node.received_at)}`].filter(Boolean).join(" · "))}</p></div></div>
      <div class="detail-status-side"><div class="detail-status-copy"><span class="node-status is-${severity}"><i class="node-live-dot"></i>${escapeHtml(severityLabel(severity))}</span>${detailServiceList(node)}<span class="detail-uptime">持续运行 ${escapeHtml(formatUptime(metrics.uptime_seconds))}</span></div></div>`;
  }

  function renderDetailFacts() {
    const node = getNode(state.selectedNode);
    if (!node) return;
    const metrics = node.metrics || {};
    const agentErrors = Number(node.agent?.collect_errors || 0) + Number(node.agent?.send_errors || 0);
    $("detail-facts").innerHTML = [
      detailFact("主机名", node.system?.hostname || "—"),
      detailFact("系统", node.system?.os || "—"),
      detailFact("内核", node.system?.kernel || "—"),
      detailFact("架构", node.system?.arch || "—"),
      detailFact("下载速率", formatRate(metrics.network_rx_rate_bps)),
      detailFact("上传速率", formatRate(metrics.network_tx_rate_bps)),
      detailFact("累计下载", formatBytes(metrics.network_rx_bytes)),
      detailFact("累计上传", formatBytes(metrics.network_tx_bytes)),
      detailFact("Agent", `${node.agent?.version || "—"} · 队列 ${Number(node.agent?.queue_depth || 0)}`),
      detailFact("采集/发送错误", String(agentErrors)),
    ].join("");
  }

  function renderDetailProbeSummary() {
    const node = getNode(state.selectedNode);
    if (!node) return;
    const probes = displayProbes(node);
    const summaries = new Map((state.detailHistory?.probe_summaries || []).map((summary) => [summary.probe_name, summary]));
    $("detail-probe-summary").innerHTML = probes.length ? probes.map((probe) => {
      const severity = currentProbeSeverity(probe, node.id);
      const tone = probeColorTone(probe);
      const latency = probe.success ? `${Math.round(Number(probe.duration_ms) || 0)} ms` : "— ms";
      const loss = formatLoss(probe.packet_loss_percent ?? probe.sample_failure_percent ?? 100);
      const summary = summaries.get(probe.name);
      const average = Number.isFinite(Number(summary?.latency_average_ms)) ? `${Math.round(Number(summary.latency_average_ms))} ms` : latency;
      const historyLoss = summary?.packet_loss_percent === null || summary?.packet_loss_percent === undefined ? loss : formatLoss(summary.packet_loss_percent);
      const selected = state.detailProbeSelection.has(probe.name);
      return `<button type="button" class="detail-probe-card probe-tone-${tone} is-${severity} ${selected ? "is-active" : ""}" data-detail-probe="${escapeHtml(probe.name)}" aria-pressed="${selected}" aria-label="${escapeHtml(`${displayProbeLabel(probe)}，平均延迟 ${average}，区间丢包 ${historyLoss}`)}">
        <i class="detail-probe-swatch" aria-hidden="true"></i>
        <span class="detail-probe-label"><strong>${escapeHtml(displayProbeLabel(probe))}</strong></span>
        <span title="平均延迟">${escapeHtml(average)}</span>
        <span title="区间丢包">${escapeHtml(historyLoss)}</span>
      </button>`;
    }).join("") : '<div class="probe-empty">此节点未配置 ICMP 延迟与丢包探测</div>';
    document.querySelectorAll("#detail-probe-actions button[data-probe-action]").forEach((button) => {
      const allSelected = probes.length > 0 && probes.every((probe) => state.detailProbeSelection.has(probe.name));
      const noneSelected = probes.every((probe) => !state.detailProbeSelection.has(probe.name));
      button.classList.toggle("is-active", button.dataset.probeAction === "all" ? allSelected : noneSelected);
    });
    renderNetworkLayerControls();
  }

  function renderNetworkLayerControls() {
    document.querySelectorAll("#network-layer-switch button[data-network-layer]").forEach((button) => {
      const active = state.detailNetworkLayers.has(button.dataset.networkLayer);
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function renderDetailEvents() {
    const events = state.detailHistory?.annotations || [];
    $("detail-events").innerHTML = events.length ? events.slice(0, 12).map((event) => {
      const severity = event.severity === "P1" || event.severity === "critical" ? "critical" : event.severity === "INFO" ? "healthy" : "warning";
      return `<div class="timeline-item"><div class="timeline-icon is-${severity}">${severity === "healthy" ? "✓" : "!"}</div><div><strong>${escapeHtml(event.title || "状态事件")}</strong><span>${escapeHtml(event.detail || "没有更多详情")}</span></div><time>${escapeHtml(formatTime(event.timestamp, state.detailHours > 24))}</time></div>`;
    }).join("") : '<div class="empty-state"><i>✓</i><strong>区间内没有事件</strong><span>重启、Agent 版本和服务变化会显示在这里</span></div>';
  }

  function probeColorTone(probe) {
    const label = displayProbeLabel(probe);
    if (label.includes("电信")) return "telecom";
    if (label.includes("联通")) return "unicom";
    if (label.includes("移动")) return "mobile";
    if (probe.category === "node-link" || label.includes("→") || label.includes("->")) return "link";
    const key = String(probe?.name || label);
    const hash = [...key].reduce((total, character) => ((total * 31) + character.codePointAt(0)) >>> 0, 0);
    return PROBE_COLOR_TONES[hash % PROBE_COLOR_TONES.length];
  }

  function probeColor(probe) {
    return cssColor(PROBE_COLOR_VARIABLES[probeColorTone(probe)]);
  }

  function alignSeries(seriesDefinitions) {
    const timestamps = [...new Set(seriesDefinitions.flatMap((series) => series.points.map((point) => Number(point.x))))]
      .filter(Number.isFinite)
      .sort((left, right) => left - right);
    const data = [timestamps];
    for (const series of seriesDefinitions) {
      const values = new Map(series.points.map((point) => {
        const value = point.y === null || point.y === undefined ? null : Number(point.y);
        return [Number(point.x), Number.isFinite(value) ? value : null];
      }));
      data.push(timestamps.map((timestamp) => values.has(timestamp) ? values.get(timestamp) : null));
    }
    return data;
  }

  function chartRange(kind) {
    if (kind === "percent") return () => [0, 100];
    return (_plot, minimum, maximum) => {
      if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return [0, 1];
      const spread = Math.max(1, maximum - minimum);
      const padding = Math.max(spread * 0.16, maximum * 0.04, 2);
      return [Math.max(0, minimum - padding), maximum + padding];
    };
  }

  function axisFormatter(kind) {
    if (kind === "rate") return (value) => formatRate(value).replace("/s", "");
    if (kind === "percent") return (value) => `${Math.round(value)}%`;
    return (value) => `${Math.round(value)}ms`;
  }

  function smoothSeriesPath() {
    return typeof window.uPlot?.paths?.spline === "function" ? window.uPlot.paths.spline() : undefined;
  }

  function ensureResizeObserver() {
    if (state.resizeObserver || typeof ResizeObserver === "undefined") return;
    state.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const host = entry.target;
        const plot = state.plotHosts.get(host);
        if (!plot || host.clientWidth < 10 || host.clientHeight < 10) continue;
        plot.setSize({ width: Math.floor(host.clientWidth), height: Math.floor(host.clientHeight) });
      }
    });
  }

  function destroyPlot(id) {
    const plot = state.plots.get(id);
    if (!plot) return;
    const host = $(id);
    if (host && state.resizeObserver) state.resizeObserver.unobserve(host);
    if (host) state.plotHosts.delete(host);
    plot.destroy();
    state.plots.delete(id);
    if (host) host.replaceChildren();
  }

  function destroyPlots() {
    for (const id of [...state.plots.keys()]) destroyPlot(id);
  }

  function positionPlotTooltip(host, plot, tooltip) {
    const anchorX = plot.over.offsetLeft + plot.cursor.left;
    const anchorY = plot.over.offsetTop + plot.cursor.top;
    const gap = 11;
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    let left = anchorX + gap;
    if (left + width > host.clientWidth - 7) left = anchorX - width - gap;
    left = Math.max(7, Math.min(left, host.clientWidth - width - 7));
    const top = Math.max(7, Math.min(anchorY - height / 2, host.clientHeight - height - 7));
    tooltip.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }

  function metricTooltipPlugin(host, definitions, formatter) {
    let tooltip = null;
    let frame = null;
    return {
      hooks: {
        init: [(plot) => {
          tooltip = document.createElement("div");
          tooltip.className = "plot-tooltip plot-tooltip-metric";
          tooltip.hidden = true;
          tooltip.setAttribute("role", "status");
          host.appendChild(tooltip);
          plot.over.setAttribute("aria-label", "移动鼠标或触摸图表查看采样详情");
        }],
        setCursor: [(plot) => {
          if (!tooltip) return;
          const index = plot.cursor.idx;
          if (index === null || index === undefined || plot.cursor.left < 0 || plot.cursor.top < 0) {
            tooltip.hidden = true;
            return;
          }
          const timestamp = Number(plot.data[0][index]);
          if (!Number.isFinite(timestamp)) {
            tooltip.hidden = true;
            return;
          }
          const rows = definitions.map((series, seriesIndex) => {
            const value = Number(plot.data[seriesIndex + 1]?.[index]);
            return `<div class="plot-tooltip-row is-single">
              <span class="plot-tooltip-target"><i style="--tooltip-color:${escapeHtml(series.color)}"></i><b>${escapeHtml(series.label)}</b></span>
              <span><b>${Number.isFinite(value) ? escapeHtml(formatter(value)) : "—"}</b></span>
            </div>`;
          }).join("");
          tooltip.innerHTML = `<time>${escapeHtml(formatTime(timestamp, true))}</time><div class="plot-tooltip-list">${rows}</div>`;
          tooltip.hidden = false;
          if (frame) cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => tooltip && !tooltip.hidden && positionPlotTooltip(host, plot, tooltip));
        }],
        destroy: [() => {
          if (frame) cancelAnimationFrame(frame);
          tooltip?.remove();
          tooltip = null;
        }],
      },
    };
  }

  function renderPlot(id, emptyId, definitions, settings = {}) {
    destroyPlot(id);
    const host = $(id);
    const empty = $(emptyId);
    const usable = definitions.filter((series) => series.points.some((point) =>
      point.y !== null && point.y !== undefined && Number.isFinite(Number(point.y))));
    if (!host || !usable.length || typeof window.uPlot !== "function") {
      if (empty) empty.classList.remove("is-hidden");
      return;
    }
    if (empty) empty.classList.add("is-hidden");
    const muted = cssColor("--muted");
    const line = cssColor("--line");
    const formatter = settings.formatter || axisFormatter(settings.kind);
    const options = {
      width: Math.max(320, Math.floor(host.clientWidth || 700)),
      height: Math.max(160, Math.floor(host.clientHeight || 280)),
      padding: [10, 10, 2, 0],
      legend: { show: false },
      cursor: {
        drag: { x: true, y: false, uni: 24 },
        sync: settings.syncKey ? { key: settings.syncKey } : undefined,
        focus: { prox: 8 },
        points: { size: 7, width: 2 },
      },
      select: { show: true },
      scales: { x: { time: true }, y: { auto: true, range: chartRange(settings.kind) } },
      axes: [
        {
          stroke: muted,
          grid: { show: true, stroke: line, width: 1, dash: [4, 6] },
          ticks: { show: false },
          font: "14px system-ui",
          size: 28,
          gap: 8,
          values: (_plot, values) => values.map((value) => formatAxisTime(value, state.detailHours)),
        },
        {
          stroke: muted,
          grid: { show: true, stroke: line, width: 1, dash: [4, 6] },
          ticks: { show: false },
          font: "14px system-ui",
          size: settings.kind === "rate" ? 82 : 62,
          gap: 8,
          values: (_plot, values) => values.map(formatter),
        },
      ],
      series: [
        { label: "时间", value: (_plot, value) => formatTime(value, true) },
        ...usable.map((series) => ({
          label: series.label,
          stroke: series.color,
          width: series.width || 2.25,
          paths: smoothSeriesPath(),
          spanGaps: false,
          points: { show: false },
          value: (_plot, value) => value === null || value === undefined ? "—" : formatter(value),
        })),
      ],
      plugins: [metricTooltipPlugin(host, usable, formatter)],
    };
    const plot = new window.uPlot(options, alignSeries(usable), host);
    state.plots.set(id, plot);
    state.plotHosts.set(host, plot);
    ensureResizeObserver();
    if (state.resizeObserver) state.resizeObserver.observe(host);
  }

  function networkLossMarkersPlugin(definitions, enabled) {
    const events = enabled ? definitions.flatMap((series) => (series.lossPoints || [])
      .map((point) => ({ timestamp: Number(point.x), loss: Number(point.y), color: series.color }))
      .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.loss) && point.loss > 0)) : [];
    return {
      hooks: {
        draw: [(plot) => {
          if (!events.length) return;
          const ratio = Number(window.uPlot?.pxRatio || window.devicePixelRatio || 1);
          const { ctx, bbox } = plot;
          ctx.save();
          ctx.lineCap = "butt";
          for (const event of events) {
            if (event.timestamp < plot.scales.x.min || event.timestamp > plot.scales.x.max) continue;
            const x = Math.round(plot.valToPos(event.timestamp, "x", true)) + 0.5;
            const strength = Math.sqrt(clamp(event.loss, 0, 100) / 100);
            ctx.beginPath();
            ctx.moveTo(x, bbox.top);
            ctx.lineTo(x, bbox.top + bbox.height);
            ctx.strokeStyle = colorWithAlpha(event.color, 0.34 + strength * 0.48);
            ctx.lineWidth = (1.15 + strength * 2.1) * ratio;
            ctx.stroke();
          }
          ctx.restore();
        }],
      },
    };
  }

  function networkTooltipPlugin(host, definitions) {
    let tooltip = null;
    let frame = null;
    const lossMaps = definitions.map((series) => new Map((series.lossPoints || []).map((point) => [Number(point.x), Number(point.y)])));
    return {
      hooks: {
        init: [(plot) => {
          tooltip = document.createElement("div");
          tooltip.className = "plot-tooltip";
          tooltip.hidden = true;
          tooltip.setAttribute("role", "status");
          host.appendChild(tooltip);
          plot.over.setAttribute("aria-label", "移动鼠标或触摸图表查看采样详情");
        }],
        setCursor: [(plot) => {
          if (!tooltip) return;
          const index = plot.cursor.idx;
          if (index === null || index === undefined || plot.cursor.left < 0 || plot.cursor.top < 0) {
            tooltip.hidden = true;
            return;
          }
          const timestamp = Number(plot.data[0][index]);
          if (!Number.isFinite(timestamp)) {
            tooltip.hidden = true;
            return;
          }
          const rows = definitions.map((series, seriesIndex) => {
            const latency = Number(plot.data[seriesIndex + 1]?.[index]);
            const loss = lossMaps[seriesIndex].get(timestamp);
            return `<div class="plot-tooltip-row">
              <span class="plot-tooltip-target"><i style="--tooltip-color:${escapeHtml(series.color)}"></i><b>${escapeHtml(series.label)}</b></span>
              <span><em>延迟</em><b>${Number.isFinite(latency) ? `${Math.round(latency)} ms` : "—"}</b></span>
              <span><em>丢包</em><b>${Number.isFinite(loss) ? formatLoss(loss) : "—"}</b></span>
            </div>`;
          }).join("");
          tooltip.innerHTML = `<time>${escapeHtml(formatTime(timestamp, true))}</time><div class="plot-tooltip-list">${rows}</div>`;
          tooltip.hidden = false;
          if (frame) cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => tooltip && !tooltip.hidden && positionPlotTooltip(host, plot, tooltip));
        }],
        destroy: [() => {
          if (frame) cancelAnimationFrame(frame);
          tooltip?.remove();
          tooltip = null;
        }],
      },
    };
  }

  function renderNetworkPlot(id, emptyId, definitions) {
    destroyPlot(id);
    const host = $(id);
    const empty = $(emptyId);
    const usable = definitions.filter((series) =>
      series.points.some((point) => Number.isFinite(Number(point.y))) ||
      (series.lossPoints || []).some((point) => Number.isFinite(Number(point.y))));
    if (!host || !usable.length || typeof window.uPlot !== "function") {
      if (empty) empty.classList.remove("is-hidden");
      return;
    }
    if (empty) empty.classList.add("is-hidden");
    const muted = cssColor("--muted");
    const line = cssColor("--line");
    const showLatency = state.detailNetworkLayers.has("latency");
    const showLoss = state.detailNetworkLayers.has("loss");
    const options = {
      width: Math.max(320, Math.floor(host.clientWidth || 900)),
      height: Math.max(220, Math.floor(host.clientHeight || 360)),
      padding: [12, 12, 4, 0],
      legend: { show: false },
      cursor: {
        drag: { x: true, y: false, uni: 24 },
        focus: { prox: 6 },
        points: { show: showLatency, size: 8, width: 2 },
      },
      select: { show: true },
      scales: { x: { time: true }, y: { auto: true, range: chartRange("latency") } },
      axes: [
        {
          stroke: muted,
          grid: { show: true, stroke: line, width: 1, dash: [4, 7] },
          ticks: { show: false },
          font: "14px system-ui",
          size: 30,
          gap: 9,
          values: (_plot, values) => values.map((value) => formatAxisTime(value, state.detailHours)),
        },
        {
          stroke: muted,
          grid: { show: true, stroke: line, width: 1, dash: [4, 7] },
          ticks: { show: false },
          font: "14px system-ui",
          size: 66,
          gap: 9,
          values: (_plot, values) => values.map((value) => `${Math.round(value)}ms`),
        },
      ],
      series: [
        { label: "时间", value: (_plot, value) => formatTime(value, true) },
        ...usable.map((series) => ({
          label: series.label,
          stroke: showLatency ? series.color : colorWithAlpha(series.color, 0),
          width: showLatency ? 2.35 : 0,
          paths: smoothSeriesPath(),
          spanGaps: false,
          points: { show: false },
          value: (_plot, value) => value === null || value === undefined ? "—" : `${Math.round(value)} ms`,
        })),
      ],
      plugins: [networkLossMarkersPlugin(usable, showLoss), networkTooltipPlugin(host, usable)],
    };
    const plot = new window.uPlot(options, alignSeries(usable), host);
    state.plots.set(id, plot);
    state.plotHosts.set(host, plot);
    ensureResizeObserver();
    if (state.resizeObserver) state.resizeObserver.observe(host);
  }

  function renderDetailCharts() {
    const history = state.detailHistory;
    const node = getNode(state.selectedNode);
    if (!history || !node) return;
    const probes = displayProbes(node).filter((probe) => state.detailProbeSelection.has(probe.name));
    const probeRows = (history.probes || []).filter((row) => row.node_id === node.id);
    const networkSeries = probes.map((probe) => {
      const rows = probeRows.filter((row) => row.probe_name === probe.name);
      return {
        label: displayProbeLabel(probe),
        color: probeColor(probe),
        points: rows.map((row) => ({ x: Number(row.timestamp), y: row.latency_ms === null ? null : Number(row.latency_ms) })),
        lossPoints: rows.map((row) => ({ x: Number(row.timestamp), y: row.packet_loss_percent === null ? null : Number(row.packet_loss_percent) })),
      };
    });
    const totalSamples = probeRows.length;
    const selectedCount = probes.length;
    $("network-chart-state").textContent = `${selectedCount} 条线路 · ${totalSamples} 个区间采样`;
    renderNetworkPlot("network-plot", "network-empty", networkSeries);

    const metrics = history.metrics || [];
    renderPlot("traffic-plot", "traffic-empty", [
      { label: "下载", color: cssColor("--cyan"), points: metrics.map((row) => ({ x: Number(row.timestamp), y: row.network_rx_rate_bps === null ? null : Number(row.network_rx_rate_bps) })) },
      { label: "上传", color: cssColor("--amber"), points: metrics.map((row) => ({ x: Number(row.timestamp), y: row.network_tx_rate_bps === null ? null : Number(row.network_tx_rate_bps) })) },
    ], { kind: "rate", formatter: (value) => formatRate(value) });
  }

  function setDetailLoading(message = "") {
    const visible = Boolean(message);
    $("detail-loading").textContent = message;
    $("detail-loading").classList.toggle("is-hidden", !visible);
    $("detail-content").classList.toggle("is-hidden", visible);
    $("node-detail").setAttribute("aria-busy", String(visible));
  }

  function renderDetail() {
    renderDetailHero();
    renderDetailFacts();
    renderDetailProbeSummary();
    if (state.detailHistory) {
      renderDetailEvents();
      requestAnimationFrame(renderDetailCharts);
    }
  }

  function openNode(id, updateUrl = true) {
    if (!getNode(id)) { showToast("未找到该节点", true); return; }
    state.selectedNode = id;
    state.detailProbeSelection = new Set(displayProbes(getNode(id)).map((probe) => probe.name));
    state.detailHistory = availableDetailHistory(id, state.detailHours);
    $("fleet-view").classList.add("is-hidden");
    $("node-detail").classList.remove("is-hidden");
    setDetailLoading(state.detailHistory ? "" : `正在加载 ${getNode(id).label} 的历史数据…`);
    renderDetail();
    if (updateUrl) {
      const url = new URL(location.href);
      url.search = "";
      url.searchParams.set("node", id);
      history.pushState({ node: id }, "", url);
    }
    scrollTo({ top: 0, behavior: "auto" });
    void loadDetailHistory({ background: Boolean(state.detailHistory) });
  }

  function closeDetail(updateUrl = true) {
    destroyPlots();
    state.selectedNode = null;
    state.detailProbeSelection = new Set();
    state.detailHistory = null;
    setDetailLoading("");
    $("node-detail").classList.add("is-hidden");
    $("fleet-view").classList.remove("is-hidden");
    if (updateUrl) history.pushState(null, "", "/dashboard/");
    scrollTo({ top: 0, behavior: "smooth" });
  }

  async function loadLatest(manual = false) {
    if (manual) $("refresh-button").classList.add("is-spinning");
    try {
      const latest = await fetchJson("/api/v1/dashboard/latest");
      if (Number(latest.schema_version) < 2) throw new Error("unsupported dashboard schema");
      state.latest = latest;
      setView("dashboard");
      renderFleet();
      if (state.selectedNode) renderDetail();
      startTimers();
    } catch (error) {
      if (error instanceof AuthError) showAuth();
      else if (state.latest) showToast("状态刷新失败，稍后自动重试", true);
      else { showAuth(); showToast("面板数据暂时不可用", true); }
    } finally {
      $("refresh-button").classList.remove("is-spinning");
    }
  }

  async function loadFleetHistory() {
    try {
      state.fleetHistory = await fetchJson("/api/v1/dashboard/history?hours=24");
      if (!state.selectedNode) renderFleet();
      else renderDetailProbeSummary();
    } catch (error) {
      if (error instanceof AuthError) showAuth();
      else if (state.latest) showToast("线路时间格暂时无法更新", true);
    }
  }

  async function loadDetailHistory({ background = false } = {}) {
    if (!state.selectedNode) return;
    const requestedNode = state.selectedNode;
    const requestedHours = state.detailHours;
    const key = detailHistoryKey(requestedNode, requestedHours);
    try {
      let request = state.detailHistoryRequests.get(key);
      if (!request) {
        request = fetchJson(`/api/v1/dashboard/history?hours=${requestedHours}&node=${encodeURIComponent(requestedNode)}`)
          .finally(() => state.detailHistoryRequests.delete(key));
        state.detailHistoryRequests.set(key, request);
      }
      const historyData = await request;
      state.detailHistoryCache.set(key, historyData);
      if (state.selectedNode !== requestedNode || state.detailHours !== requestedHours) return;
      state.detailHistory = historyData;
      setDetailLoading("");
      renderDetail();
    } catch (error) {
      if (error instanceof AuthError) showAuth();
      else if (state.selectedNode === requestedNode && state.detailHours === requestedHours) {
        if (background && state.detailHistory) {
          showToast("精细历史暂时不可用，已保留当前数据", true);
        } else {
          setDetailLoading("节点历史暂时不可用，请稍后重试");
          showToast("节点详情加载失败", true);
        }
      }
    }
  }

  function startTimers() {
    if (!state.refreshTimer) state.refreshTimer = setInterval(() => loadLatest(false), 30_000);
    if (!state.historyTimer) state.historyTimer = setInterval(async () => {
      await loadFleetHistory();
      if (state.selectedNode) await loadDetailHistory();
    }, 5 * 60_000);
  }

  function stopTimers() {
    clearInterval(state.refreshTimer);
    clearInterval(state.historyTimer);
    state.refreshTimer = null;
    state.historyTimer = null;
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    writePreference("vpsmon-theme", theme);
    document.querySelector('meta[name="theme-color"]').setAttribute("content", theme === "light" ? "#edf2f8" : "#050607");
    if (state.latest) requestAnimationFrame(() => {
      renderFleet();
      if (state.selectedNode) renderDetail();
    });
  }

  function bindEvents() {
    $("copy-panel-command").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText("/panel"); showToast("已复制 /panel"); }
      catch { showToast("请手动在 Telegram 中发送 /panel", true); }
    });
    $("refresh-button").addEventListener("click", async () => {
      await Promise.all([loadLatest(true), loadFleetHistory(), state.selectedNode ? loadDetailHistory() : Promise.resolve()]);
      showToast("状态已刷新");
    });
    $("theme-button").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
    $("settings-button").addEventListener("click", openSettings);
    $("settings-form").addEventListener("submit", saveSettings);
    $("settings-close").addEventListener("click", closeSettings);
    $("settings-cancel").addEventListener("click", closeSettings);
    $("settings-reset").addEventListener("click", resetSettings);
    $("settings-node-list").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-settings-move]");
      if (!button) return;
      const row = button.closest("[data-settings-node]");
      const from = state.settingsDraftOrder.indexOf(row.dataset.settingsNode);
      const to = from + Number(button.dataset.settingsMove);
      if (from < 0 || to < 0 || to >= state.settingsDraftOrder.length) return;
      [state.settingsDraftOrder[from], state.settingsDraftOrder[to]] = [state.settingsDraftOrder[to], state.settingsDraftOrder[from]];
      syncSettingsNodeOrder();
    });
    $("settings-node-list").addEventListener("input", (event) => {
      if (event.target.matches(".settings-country")) event.target.value = event.target.value.toUpperCase().replace(/[^A-Z]/g, "");
    });
    $("settings-dialog").addEventListener("click", (event) => {
      if (event.target === $("settings-dialog")) closeSettings();
    });
    $("logout-button").addEventListener("click", async () => {
      try { await fetch("/auth/logout", { method: "POST", credentials: "same-origin" }); }
      finally {
        state.latest = null;
        state.fleetHistory = null;
        state.detailHistory = null;
        state.detailHistoryCache.clear();
        state.detailHistoryRequests.clear();
        state.selectedNode = null;
        history.replaceState(null, "", "/dashboard/");
        showAuth();
      }
    });
    $("node-search").addEventListener("input", (event) => { state.search = event.target.value; renderNodes(); });
    $("node-grid").addEventListener("click", (event) => {
      const card = event.target.closest("[data-node]");
      if (card) openNode(card.dataset.node);
    });
    $("node-grid").addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const card = event.target.closest("[data-node]");
      if (!card) return;
      event.preventDefault();
      openNode(card.dataset.node);
    });
    $("detail-back").addEventListener("click", () => closeDetail());
    $("detail-probe-summary").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-detail-probe]");
      if (!button) return;
      const probeName = button.dataset.detailProbe;
      if (state.detailProbeSelection.has(probeName)) state.detailProbeSelection.delete(probeName);
      else state.detailProbeSelection.add(probeName);
      renderDetailProbeSummary();
      requestAnimationFrame(renderDetailCharts);
    });
    $("detail-probe-actions").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-probe-action]");
      if (!button) return;
      const probes = displayProbes(getNode(state.selectedNode));
      state.detailProbeSelection = button.dataset.probeAction === "all"
        ? new Set(probes.map((probe) => probe.name))
        : new Set();
      renderDetailProbeSummary();
      requestAnimationFrame(renderDetailCharts);
    });
    $("network-layer-switch").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-network-layer]");
      if (!button) return;
      const layer = button.dataset.networkLayer;
      if (state.detailNetworkLayers.has(layer)) {
        if (state.detailNetworkLayers.size === 1) return;
        state.detailNetworkLayers.delete(layer);
      } else {
        state.detailNetworkLayers.add(layer);
      }
      renderNetworkLayerControls();
      requestAnimationFrame(renderDetailCharts);
    });
    $("detail-range-switch").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-hours]");
      if (!button) return;
      state.detailHours = Number(button.dataset.hours);
      document.querySelectorAll("#detail-range-switch button").forEach((item) => item.classList.toggle("is-active", item === button));
      destroyPlots();
      state.detailHistory = availableDetailHistory(state.selectedNode, state.detailHours);
      setDetailLoading(state.detailHistory ? "" : `正在读取 ${button.textContent} 历史…`);
      renderDetail();
      void loadDetailHistory({ background: Boolean(state.detailHistory) });
    });
    window.addEventListener("popstate", () => {
      const id = new URLSearchParams(location.search).get("node");
      if (id && id !== state.selectedNode) openNode(id, false);
      else if (!id && state.selectedNode) closeDetail(false);
    });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && state.latest) loadLatest(false); });
  }

  async function init() {
    state.layout = readDashboardLayout();
    applyGlobalLayout();
    setTheme(readPreference("vpsmon-theme", "dark"));
    bindEvents();
    setView("loading");
    try {
      const latest = await fetchJson("/api/v1/dashboard/latest");
      if (Number(latest.schema_version) < 2) throw new Error("unsupported dashboard schema");
      state.latest = latest;
      setView("dashboard");
      renderFleet();
      startTimers();
      await loadFleetHistory();
      if (state.initialNode) await openNode(state.initialNode, false);
    } catch (error) {
      if (error instanceof AuthError) showAuth();
      else { showAuth(); showToast("面板服务暂时不可用，请稍后重试", true); }
    }
  }

  init();
})();
