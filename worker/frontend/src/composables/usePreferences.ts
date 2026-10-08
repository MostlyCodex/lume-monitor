import { shallowRef } from "vue";
import { normalizeLayout } from "../domain/layout";
import { LAYOUT_KEY } from "../runtime";
import type { DashboardLayout } from "../types";

export function usePreferences() {
  function read() {
    try {
      return normalizeLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}"));
    } catch {
      return normalizeLayout({});
    }
  }
  const layout = shallowRef(read());
  let knownIds: Set<string> | undefined;
  function save(value: DashboardLayout) {
    const next = normalizeLayout(value);
    const allowed = knownIds;
    if (allowed) next.order = next.order.filter((id) => allowed.has(id));
    // The in-memory order applies even when storage is unavailable; it just won't survive a reload.
    layout.value = next;
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    } catch {
      return false;
    }
    return true;
  }
  function pruneNodes(ids: string[]) {
    const allowed = (knownIds = new Set(ids));
    if (layout.value.order.some((id) => !allowed.has(id))) save(layout.value);
  }
  return { layout, save, pruneNodes };
}
