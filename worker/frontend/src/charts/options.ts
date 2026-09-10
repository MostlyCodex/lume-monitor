import uPlot from "uplot";
import type { ChartSeries, NetworkLayer } from "../types";
import { clamp, formatAxisTime, formatRate, formatTime } from "../domain/format";
import { chartRange, colorWithAlpha, finite } from "./series";
import { cssColor } from "./theme";

export interface ChartOptions {
  kind: "network" | "rate";
  width: number;
  height: number;
  hours: number;
  layers: readonly NetworkLayer[];
  onCursor: (plot: uPlot) => void;
}
function lossMarkers(series: ChartSeries[], enabled: boolean): uPlot.Plugin {
  const events = enabled
    ? series.flatMap((item) =>
        (item.lossPoints ?? [])
          .filter((point) => finite(point.y) && point.y > 0)
          .map((point) => ({ x: point.x, loss: point.y!, color: item.color })),
      )
    : [];
  return {
    hooks: {
      draw: [
        (plot) => {
          const { ctx, bbox } = plot;
          ctx.save();
          ctx.beginPath();
          ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
          ctx.clip();
          ctx.lineCap = "butt";
          for (const event of events) {
            if (
              event.x < (plot.scales.x.min ?? -Infinity) ||
              event.x > (plot.scales.x.max ?? Infinity)
            )
              continue;
            const x = Math.round(plot.valToPos(event.x, "x", true)) + 0.5;
            const strength = Math.sqrt(clamp(event.loss, 0, 100) / 100);
            ctx.beginPath();
            ctx.moveTo(x, bbox.top);
            ctx.lineTo(x, bbox.top + bbox.height);
            ctx.strokeStyle = colorWithAlpha(event.color, 0.34 + strength * 0.48);
            ctx.lineWidth = (1.15 + strength * 2.1) * uPlot.pxRatio;
            ctx.stroke();
          }
          ctx.restore();
        },
      ],
    },
  };
}
export function chartOptions(series: ChartSeries[], options: ChartOptions): uPlot.Options {
  const network = options.kind === "network",
    latency = !network || options.layers.includes("latency");
  const longDates = options.hours > 24 && options.hours <= 720;
  const format = (value: number) =>
    network ? `${Math.round(value)}ms` : formatRate(value).replace("/s", "");
  const axis: uPlot.Axis = {
    stroke: cssColor("--muted"),
    grid: { show: true, stroke: cssColor("--line"), width: 1, dash: [4, 7] },
    ticks: { show: false },
    font: "14px system-ui",
    gap: 8,
  };
  return {
    width: options.width,
    height: options.height,
    // Date + hour labels need room at the right edge as well as between ticks.
    padding: [12, longDates ? 48 : 20, 4, 0],
    legend: { show: false },
    cursor: {
      drag: { x: true, y: false, uni: 24 },
      focus: { prox: 6 },
      points: { show: latency, size: 8, width: 2 },
    },
    select: { show: true, left: 0, top: 0, width: 0, height: 0 },
    scales: { x: { time: true }, y: { auto: true, range: chartRange } },
    axes: [
      {
        ...axis,
        size: 30,
        space: longDates ? 116 : 64,
        values: (_plot, values) => values.map((value) => formatAxisTime(value, options.hours)),
      },
      { ...axis, size: network ? 66 : 82, values: (_plot, values) => values.map(format) },
    ],
    series: [
      { label: "时间", value: (_plot, value) => formatTime(value, true) },
      ...series.map((item) => ({
        label: item.label,
        stroke: latency ? item.color : colorWithAlpha(item.color, 0),
        width: latency ? 2.35 : 0,
        paths: uPlot.paths.spline?.(),
        spanGaps: false,
        points: { show: false },
        value: (_plot: uPlot, value: number | null) => (finite(value) ? format(value) : "—"),
      })),
    ],
    plugins: [lossMarkers(series, network && options.layers.includes("loss"))],
    hooks: { setCursor: [options.onCursor] },
  };
}
