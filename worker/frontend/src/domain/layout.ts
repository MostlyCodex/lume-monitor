import type { DashboardLayout } from "../types";
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
/** Stored browser data is untrusted: only the node order survives, older display overrides are dropped. */
export function normalizeLayout(value: unknown): DashboardLayout {
  const source = record(value);
  const order = Array.isArray(source.order)
    ? [
        ...new Set(
          source.order.filter(
            (id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id),
          ),
        ),
      ].slice(0, 256)
    : [];
  return { order };
}
