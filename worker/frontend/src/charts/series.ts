import type { ChartSeries } from "../types";
export function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
/** Align by timestamp and retain null gaps; an absent measurement is never a zero. */
export function alignSeries(series: ChartSeries[]): [number[], ...(number | null)[][]] {
  const timestamps = [
    ...new Set(
      series.flatMap((item) =>
        [...item.points, ...(item.lossPoints ?? [])].map((point) => point.x),
      ),
    ),
  ]
    .filter(finite)
    .sort((a, b) => a - b);
  const values = series.map((item) => {
    const points = new Map(item.points.map((point) => [point.x, finite(point.y) ? point.y : null]));
    return timestamps.map((timestamp) => points.get(timestamp) ?? null);
  });
  return [timestamps, ...values];
}
/** ECharts uses milliseconds; the third dimension retains failures even without latency. */
export function chartData(series: ChartSeries[]) {
  const [timestamps, ...values] = alignSeries(series);
  return series.map((item, index) => {
    const failures = new Map(item.lossPoints?.map((point) => [point.x, point.y]));
    return timestamps.map((timestamp, pointIndex): [number, number | "-", number | "-"] => {
      const loss = failures.get(timestamp);
      return [timestamp * 1000, values[index][pointIndex] ?? "-", finite(loss) ? loss : "-"];
    });
  });
}
export function chartRange(minimum: number, maximum: number): [number, number] {
  if (!finite(minimum) || !finite(maximum)) return [0, 1];
  const padding = Math.max(Math.max(1, maximum - minimum) * 0.16, maximum * 0.04, 2);
  return [Math.max(0, minimum - padding), maximum + padding];
}
