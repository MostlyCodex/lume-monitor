import type { ComposeOption } from "echarts/core";
import type { LineSeriesOption } from "echarts/charts";
import type {
  GridComponentOption,
  TooltipComponentOption,
  MarkLineComponentOption,
} from "echarts/components";
import type { ChartSeries, NetworkLayer } from "../types";
import { clamp, formatAxisTime, formatRate } from "../domain/format";
import { chartData, chartRange, finite } from "./series";
import { cssColor } from "./theme";

export type HistoryChartOption = ComposeOption<
  LineSeriesOption | GridComponentOption | TooltipComponentOption | MarkLineComponentOption
>;
export interface ChartOptions {
  kind: "network" | "rate";
  hours: number;
  layers: readonly NetworkLayer[];
}
export function chartOptions(series: ChartSeries[], options: ChartOptions): HistoryChartOption {
  const network = options.kind === "network";
  const latency = !network || options.layers.includes("latency");
  const data = chartData(series);
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const longDates = options.hours > 24 && options.hours <= 720;
  return {
    animation: false,
    backgroundColor: "transparent",
    textStyle: { fontFamily: "system-ui", color: cssColor("--muted") },
    grid: { top: 16, left: 8, right: longDates ? 36 : 20, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      triggerOn: touch ? "click" : "mousemove|click|mousewheel",
      alwaysShowContent: touch,
      confine: true,
      // A fixed inset remains in bounds on the first touch, before the Vue slot is measured.
      position: [8, 8],
      enterable: true,
      transitionDuration: 0,
      backgroundColor: "transparent",
      borderWidth: 0,
      padding: 0,
      extraCssText: "box-shadow:none;white-space:normal;",
      axisPointer: {
        type: "line",
        lineStyle: { color: cssColor("--text-soft"), width: 1, type: "dashed" },
      },
    },
    xAxis: {
      type: "time",
      boundaryGap: [0, 0],
      splitNumber: longDates ? 6 : 8,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: cssColor("--muted"),
        fontSize: 12,
        hideOverlap: true,
        padding: [0, 6],
        margin: 14,
        formatter: (value: number) => formatAxisTime(value / 1000, options.hours),
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      minInterval: network ? 1 : undefined,
      min: ({ min, max }) => chartRange(min, max)[0],
      max: ({ min, max }) => chartRange(min, max)[1],
      splitNumber: 4,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: cssColor("--muted"),
        fontSize: 12,
        margin: 12,
        formatter: (value: number) =>
          network ? `${Math.round(value)}ms` : formatRate(value).replace("/s", ""),
      },
      splitLine: { lineStyle: { color: cssColor("--line"), type: "dashed" } },
    },
    // Keep two labels legible on phones; the wrapper resizes the same chart instance.
    media: [
      {
        query: { maxWidth: 520 },
        option: {
          xAxis: {
            splitNumber: longDates ? 2 : 4,
            axisLabel: {
              formatter: (value: number) =>
                formatAxisTime(value / 1000, options.hours).replace(" ", "\n"),
            },
          },
        },
      },
    ],
    series: series.map(
      (item, index): LineSeriesOption => ({
        id: item.id,
        name: item.label,
        type: "line",
        data: data[index],
        encode: { x: 0, y: 1 },
        connectNulls: false,
        smooth: false,
        showSymbol: false,
        symbol: "circle",
        symbolSize: 6,
        itemStyle: { color: item.color, opacity: latency ? 1 : 0 },
        lineStyle: { color: item.color, width: 2, opacity: latency ? 1 : 0 },
        emphasis: { disabled: true },
        // Native marks retain failure visibility when every latency measurement is missing.
        markLine: {
          silent: true,
          symbol: "none",
          label: { show: false },
          data:
            network && options.layers.includes("loss")
              ? (item.lossPoints ?? [])
                  .filter((point) => finite(point.x) && finite(point.y) && point.y > 0)
                  .map((point) => {
                    const strength = Math.sqrt(clamp(point.y!, 0, 100) / 100);
                    return {
                      xAxis: point.x * 1000,
                      lineStyle: {
                        color: item.color,
                        type: "solid",
                        opacity: 0.34 + strength * 0.48,
                        width: 1.15 + strength * 2.1,
                      },
                    };
                  })
              : [],
        },
      }),
    ),
  };
}
