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
  watch(
    layout,
    (value) => {
      document.title = value.brand;
    },
    { immediate: true },
  );
  function save(value: DashboardLayout) {
    const next = normalizeLayout(value);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    } catch {
      return false;
    }
    // Commit only after storage succeeds; failed saves retain the current layout.
    layout.value = next;
    return true;
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
  return { layout, save, reset, discardUnreadableBackground };
}
