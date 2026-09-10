import type uPlot from "uplot";
import type { ChartSeries } from "../types";
import { clamp } from "../domain/format";
export function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
/** Align by timestamp and retain null gaps; an absent measurement is never a zero. */
export function alignSeries(series: ChartSeries[]): uPlot.AlignedData {
  const timestamps = [...new Set(series.flatMap((item) => item.points.map((point) => point.x)))]
    .filter(finite)
    .sort((a, b) => a - b);
  const values = series.map((item) => {
    const points = new Map(item.points.map((point) => [point.x, finite(point.y) ? point.y : null]));
    return timestamps.map((timestamp) => points.get(timestamp) ?? null);
  });
  return [timestamps, ...values];
}
export function chartRange(_plot: uPlot, minimum: number, maximum: number): [number, number] {
  if (!finite(minimum) || !finite(maximum)) return [0, 1];
  const padding = Math.max(Math.max(1, maximum - minimum) * 0.16, maximum * 0.04, 2);
  return [Math.max(0, minimum - padding), maximum + padding];
}
export function colorWithAlpha(color: string, alpha: number) {
  const opacity = clamp(alpha, 0, 1),
    hex = color.match(/^#([\da-f]{6})$/i);
  if (hex) {
    const value = parseInt(hex[1], 16);
    return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${opacity})`;
  }
  const rgb = color.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  return rgb ? `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${opacity})` : color;
}
