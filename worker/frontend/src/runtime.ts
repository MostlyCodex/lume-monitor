export const DEMO_MODE = import.meta.env.DEV || document.documentElement.dataset.demo === "true";
export const DASHBOARD_HOME = DEMO_MODE ? new URL("./", location.href).pathname : "/dashboard/";
export const LAYOUT_KEY = DEMO_MODE ? "lume-demo-layout-v1" : "vpsmon-dashboard-layout-v1";
// Both Vite's source modules and generated assets live one level below the static root.
export const DEFAULT_BACKGROUND = new URL(
  "background-lume.jpg",
  new URL(/* @vite-ignore */ "../", import.meta.url),
).href;
export const HISTORY_RANGES = [6, 24, 168, 720, 2160] as const;
export const LATEST_INTERVAL = 30_000;
export const HISTORY_INTERVAL = 5 * 60_000;
