import type { DashboardLayout, NodeDisplay } from "../types";
export const BACKGROUND_MAX_BYTES = 10 * 1024 * 1024;
export const BACKGROUND_MAX_PIXELS = 24_000_000;
export const BACKGROUND_MAX_LENGTH = 1_500_000;
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown, maximum: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, maximum) || fallback : fallback;
}
/** Stored browser data is untrusted: only copy supported fields and bounded image data URLs. */
export function normalizeLayout(value: unknown): DashboardLayout {
  const source = record(value);
  const nodes: Record<string, NodeDisplay> = Object.create(null);
  for (const [id, entry] of Object.entries(record(source.nodes)).slice(0, 256)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) continue;
    const item = record(entry),
      country = text(item.country, 2).toUpperCase();
    nodes[id] = {
      label: text(item.label, 64),
      role: text(item.role, 80),
      region: text(item.region, 80),
      country: /^[A-Z]{2}$/.test(country) ? country : "",
    };
  }
  const order = Array.isArray(source.order)
    ? [
        ...new Set(
          source.order.filter(
            (id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id),
          ),
        ),
      ].slice(0, 256)
    : [];
  const background =
    typeof source.background === "string" &&
    source.background.length <= BACKGROUND_MAX_LENGTH &&
    /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(source.background)
      ? source.background
      : "";
  return { brand: text(source.brand, 48, "Lume"), nodes, order, background };
}
