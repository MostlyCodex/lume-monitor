import { shallowRef, watch } from "vue";
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
  watch(
    layout,
    (value) => {
      document.title = value.brand;
    },
    { immediate: true },
  );
  function save(value: DashboardLayout) {
    const next = normalizeLayout(value);
    const allowed = knownIds;
    if (allowed) {
      next.nodes = Object.fromEntries(Object.entries(next.nodes).filter(([id]) => allowed.has(id)));
      next.order = next.order.filter((id) => allowed.has(id));
    }
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    } catch {
      return false;
    }
    // Commit only after storage succeeds; failed saves retain the current layout.
    layout.value = next;
    return true;
  }
  function pruneNodes(ids: string[]) {
    const allowed = (knownIds = new Set(ids));
    if (
      Object.keys(layout.value.nodes).some((id) => !allowed.has(id)) ||
      layout.value.order.some((id) => !allowed.has(id))
    )
      save(layout.value);
  }
  function reset() {
    try {
      localStorage.removeItem(LAYOUT_KEY);
    } catch {
      return false;
    }
    layout.value = normalizeLayout({});
    return true;
  }
  function discardUnreadableBackground(value: string) {
    if (layout.value.background === value) layout.value = { ...layout.value, background: "" };
  }
  return { layout, save, reset, pruneNodes, discardUnreadableBackground };
}
