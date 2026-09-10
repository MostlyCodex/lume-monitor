import { ref, watch } from "vue";
import type { Theme } from "../types";
export function useTheme() {
  const theme = ref<Theme>("dark");
  try {
    if (localStorage.getItem("vpsmon-theme") === "light") theme.value = "light";
  } catch {
    /* Storage may be disabled. */
  }
  watch(
    theme,
    (value) => {
      document.documentElement.dataset.theme = value;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", value === "light" ? "#edf2f8" : "#050607");
      try {
        localStorage.setItem("vpsmon-theme", value);
      } catch {
        /* Theme still applies to this session. */
      }
    },
    { immediate: true },
  );
  function toggleTheme() {
    theme.value = theme.value === "dark" ? "light" : "dark";
  }
  return { theme, toggleTheme };
}
