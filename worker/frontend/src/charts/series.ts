export function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
