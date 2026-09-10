import { computed, onMounted, onScopeDispose, ref, shallowRef } from "vue";
import { AuthError, type DashboardApi } from "../services/dashboardApi";
import { DASHBOARD_HOME, HISTORY_INTERVAL, HISTORY_RANGES, LATEST_INTERVAL } from "../runtime";
import type { HistoryHours, HistorySnapshot, LatestSnapshot, View } from "../types";

type Notice = (message: string, error?: boolean) => void;
interface CachedHistory {
  data: HistorySnapshot;
  loadedAt: number;
}

/** Owns request lifetimes, polling and navigation; components never fetch or start timers. */
export function useDashboard(api: DashboardApi, notify: Notice) {
  const latest = shallowRef<LatestSnapshot | null>(null);
  const fleetHistory = shallowRef<HistorySnapshot | null>(null);
  const detailHistory = shallowRef<HistorySnapshot | null>(null);
  const view = ref<View>("loading");
  const selectedId = ref<string | null>(new URLSearchParams(location.search).get("node"));
  const hours = ref<HistoryHours>(24);
  const refreshing = ref(false);
  const detailError = ref("");
  const cache = new Map<string, CachedHistory>();
  const pending = new Map<string, Promise<boolean>>();
  const controllers = new Set<AbortController>();
  let fleetLoadedAt = 0;
  let generation = 0;
  let disposed = false;
  let latestTimer: ReturnType<typeof setInterval> | undefined;
  let historyTimer: ReturnType<typeof setInterval> | undefined;
  const detailLoading = computed(
    () => selectedId.value !== null && !detailHistory.value && !detailError.value,
  );
  const key = () => `${selectedId.value}:${hours.value}`;

  function stopTimers() {
    clearInterval(latestTimer);
    clearInterval(historyTimer);
    latestTimer = historyTimer = undefined;
  }
  function invalidateRequests() {
    // A late response from an expired session must never restore the dashboard.
    generation++;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    pending.clear();
  }
  function showAuth() {
    stopTimers();
    invalidateRequests();
    latest.value = null;
    fleetHistory.value = null;
    detailHistory.value = null;
    cache.clear();
    view.value = "auth";
  }
  async function request<T>(
    id: string,
    fetcher: (signal: AbortSignal) => Promise<T>,
    accept: (data: T) => void,
  ): Promise<boolean> {
    if (pending.has(id)) return pending.get(id)!;
    const epoch = generation;
    const controller = new AbortController();
    controllers.add(controller);
    const result = (async () => {
      try {
        const data = await fetcher(controller.signal);
        if (disposed || epoch !== generation) return false;
        accept(data);
        return true;
      } catch (error) {
        if (controller.signal.aborted || disposed || epoch !== generation) return false;
        if (error instanceof AuthError) showAuth();
        else {
          if (view.value === "loading") showAuth();
          notify("数据暂时无法更新，请稍后重试", true);
        }
        return false;
      } finally {
        controllers.delete(controller);
      }
    })();
    pending.set(id, result);
    try {
      return await result;
    } finally {
      if (pending.get(id) === result) pending.delete(id);
    }
  }
  function canRefresh() {
    return !disposed && !document.hidden && view.value === "dashboard";
  }
  function retainKnownHistory(data: HistorySnapshot): HistorySnapshot {
    const ids = latest.value?.catalog.known_node_ids;
    if (!ids) return data;
    const known = new Set(ids);
    return {
      ...data,
      metrics: data.metrics.filter((row) => known.has(row.node_id)),
      probes: data.probes.filter((row) => known.has(row.node_id)),
      annotations: data.annotations.filter((row) => known.has(row.node_id)),
    };
  }
  async function loadLatest(initial = false) {
    if (!initial && !canRefresh()) return false;
    return request(
      "latest",
      (signal) => api.latest(signal),
      (data) => {
        latest.value = data;
        if (data.catalog.known_node_ids) {
          for (const cachedKey of cache.keys())
            if (!data.catalog.known_node_ids.includes(cachedKey.split(":")[0]))
              cache.delete(cachedKey);
          if (fleetHistory.value) fleetHistory.value = retainKnownHistory(fleetHistory.value);
        }
        view.value = "dashboard";
        startTimers();
        if (selectedId.value && !data.catalog.nodes.some((node) => node.id === selectedId.value))
          closeNode();
      },
    );
  }
  async function loadFleet() {
    if (!canRefresh()) return false;
    return request(
      "fleet",
      (signal) => api.history(24, null, signal),
      (data) => {
        fleetHistory.value = retainKnownHistory(data);
        fleetLoadedAt = Date.now();
      },
    );
  }
  function preview(): HistorySnapshot | null {
    const history = fleetHistory.value;
    if (!history || hours.value > 24) return null;
    const since = history.server_time - hours.value * 3600;
    return {
      ...history,
      hours: hours.value,
      selected_node: selectedId.value,
      metrics: history.metrics.filter(
        (row) => row.node_id === selectedId.value && row.timestamp >= since,
      ),
      probes: history.probes.filter(
        (row) => row.node_id === selectedId.value && row.timestamp >= since,
      ),
      annotations: history.annotations.filter(
        (row) => row.node_id === selectedId.value && row.timestamp >= since,
      ),
      probe_summaries: [],
    };
  }
  function restoreHistory() {
    detailError.value = "";
    detailHistory.value = cache.get(key())?.data ?? preview();
  }
  async function loadDetail() {
    if (!canRefresh() || !selectedId.value) return false;
    const requestedKey = key(),
      node = selectedId.value,
      range = hours.value;
    const ok = await request(
      `detail:${requestedKey}`,
      (signal) => api.history(range, node, signal),
      (data) => {
        if (
          latest.value?.catalog.known_node_ids &&
          !latest.value.catalog.known_node_ids.includes(node)
        )
          return;
        cache.delete(requestedKey);
        cache.set(requestedKey, { data, loadedAt: Date.now() });
        // Bound memory when users inspect many nodes and ranges in one session.
        if (cache.size > 30) cache.delete(cache.keys().next().value!);
        if (key() === requestedKey) {
          detailHistory.value = data;
          detailError.value = "";
        }
      },
    );
    if (!ok && key() === requestedKey && !detailHistory.value && view.value === "dashboard") {
      detailError.value = "历史数据读取失败，请点击刷新重试";
    }
    return ok;
  }
  function openNode(id: string, updateUrl = true) {
    if (!latest.value?.catalog.nodes.some((node) => node.id === id)) {
      notify("未找到该节点", true);
      return;
    }
    selectedId.value = id;
    restoreHistory();
    if (updateUrl) {
      const url = new URL(DASHBOARD_HOME, location.origin);
      url.searchParams.set("node", id);
      history.pushState(null, "", url);
    }
    window.scrollTo({ top: 0, behavior: "auto" });
    void loadDetail();
  }
  function closeNode(updateUrl = true) {
    selectedId.value = null;
    detailHistory.value = null;
    detailError.value = "";
    if (updateUrl) history.pushState(null, "", DASHBOARD_HOME);
    window.scrollTo({ top: 0, behavior: "auto" });
  }
  function setHours(value: HistoryHours) {
    if (!HISTORY_RANGES.includes(value)) return;
    hours.value = value;
    restoreHistory();
    void loadDetail();
  }
  async function refresh() {
    if (!canRefresh() || refreshing.value) return;
    refreshing.value = true;
    try {
      const results = await Promise.all([
        loadLatest(),
        loadFleet(),
        selectedId.value ? loadDetail() : Promise.resolve(true),
      ]);
      if (results.every(Boolean) && view.value === "dashboard") notify("状态已刷新");
    } finally {
      refreshing.value = false;
    }
  }
  function startTimers() {
    if (!canRefresh()) return;
    latestTimer ??= setInterval(() => {
      void loadLatest();
    }, LATEST_INTERVAL);
    historyTimer ??= setInterval(() => {
      void loadFleet();
      if (selectedId.value) void loadDetail();
    }, HISTORY_INTERVAL);
  }
  function visibilityChanged() {
    if (document.hidden) {
      stopTimers();
      return;
    }
    if (!canRefresh()) return;
    startTimers();
    void loadLatest();
    if (Date.now() - fleetLoadedAt >= HISTORY_INTERVAL) void loadFleet();
    if (selectedId.value && Date.now() - (cache.get(key())?.loadedAt ?? 0) >= HISTORY_INTERVAL)
      void loadDetail();
  }
  function navigateBack() {
    const id = new URLSearchParams(location.search).get("node");
    if (id) openNode(id, false);
    else closeNode(false);
  }
  async function logout() {
    try {
      await api.logout();
      showAuth();
      selectedId.value = null;
      history.replaceState(null, "", DASHBOARD_HOME);
    } catch {
      notify("退出失败，请检查网络后重试", true);
    }
  }
  onMounted(async () => {
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("popstate", navigateBack);
    if (await loadLatest(true)) {
      await loadFleet();
      if (selectedId.value) await loadDetail();
    }
  });
  onScopeDispose(() => {
    disposed = true;
    stopTimers();
    invalidateRequests();
    document.removeEventListener("visibilitychange", visibilityChanged);
    window.removeEventListener("popstate", navigateBack);
  });
  return {
    latest,
    fleetHistory,
    detailHistory,
    view,
    selectedId,
    hours,
    refreshing,
    detailLoading,
    detailError,
    openNode,
    closeNode,
    setHours,
    refresh,
    logout,
  };
}
