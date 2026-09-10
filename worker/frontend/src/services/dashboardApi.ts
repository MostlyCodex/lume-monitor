import type { HistoryHours, HistorySnapshot, LatestSnapshot } from "../types";

export class AuthError extends Error {}
export interface DashboardApi {
  latest(signal: AbortSignal): Promise<LatestSnapshot>;
  history(hours: HistoryHours, node: string | null, signal: AbortSignal): Promise<HistorySnapshot>;
  logout(): Promise<void>;
}

/** Keep transport and the fictional demo behind the same explicit interface. */
export function createDashboardApi(demo: boolean): DashboardApi {
  let demoData: Promise<ReturnType<typeof import("../demo/data.js").createDemoData>> | undefined;
  const fixture = () =>
    (demoData ??= import("../demo/data.js").then((module) => module.createDemoData()));
  async function request<T>(path: string, signal: AbortSignal): Promise<T> {
    const response = await fetch(path, {
      signal,
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (response.status === 401) throw new AuthError("authentication required");
    if (!response.ok) throw new Error(`request failed: ${response.status}`);
    return response.json() as Promise<T>;
  }
  return {
    async latest(signal) {
      const data = demo
        ? (await fixture()).latestData()
        : await request<LatestSnapshot>("/api/v1/dashboard/latest", signal);
      if (
        !(data?.schema_version >= 2) ||
        !Array.isArray(data.nodes) ||
        !Array.isArray(data.catalog?.nodes)
      ) {
        throw new Error("unsupported dashboard response");
      }
      return data;
    },
    async history(hours, node, signal) {
      if (demo) return (await fixture()).historyData(hours, node);
      const query = new URLSearchParams({ hours: String(hours) });
      if (node) query.set("node", node);
      const data = await request<HistorySnapshot>(`/api/v1/dashboard/history?${query}`, signal);
      if (
        !(data?.schema_version >= 2) ||
        !Array.isArray(data.metrics) ||
        !Array.isArray(data.probes) ||
        !Array.isArray(data.annotations)
      ) {
        throw new Error("unsupported history response");
      }
      return data;
    },
    async logout() {
      if (demo) return;
      const response = await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("logout failed");
    },
  };
}
