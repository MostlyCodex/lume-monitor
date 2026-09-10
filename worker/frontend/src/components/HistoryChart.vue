<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { ChartSeries, NetworkLayer, Theme } from "../types";
import { alignSeries, finite } from "../charts/series";
import { chartOptions } from "../charts/options";
import { formatLoss, formatRate, formatTime } from "../domain/format";

const props = defineProps<{
  id: string;
  emptyId: string;
  series: ChartSeries[];
  kind: "network" | "rate";
  hours: number;
  theme: Theme;
  layers: readonly NetworkLayer[];
}>();
const host = ref<HTMLElement | null>(null),
  canvas = ref<HTMLElement | null>(null),
  tip = ref<HTMLElement | null>(null);
const tooltip = shallowRef<{
  time: number;
  rows: { label: string; color: string; value: string; loss: string; failureLabel: string }[];
} | null>(null);
const usable = computed(() =>
  props.series.filter(
    (series) =>
      series.points.some((point) => finite(point.y)) ||
      (props.kind === "network" && series.lossPoints?.some((point) => finite(point.y))),
  ),
);
let plot: uPlot | null = null,
  observer: ResizeObserver | null = null,
  frame = 0;
function disposePlot() {
  cancelAnimationFrame(frame);
  observer?.disconnect();
  observer = null;
  plot?.destroy();
  plot = null;
  tooltip.value = null;
}
function cursorChanged(current: uPlot) {
  const index = current.cursor.idx,
    left = current.cursor.left ?? -1,
    top = current.cursor.top ?? -1;
  if (index == null || left < 0 || top < 0) {
    tooltip.value = null;
    return;
  }
  const time = current.data[0][index];
  tooltip.value = {
    time,
    rows: usable.value.map((series, offset) => {
      const value = current.data[offset + 1][index],
        loss = series.lossPoints?.find((point) => point.x === time)?.y;
      return {
        label: series.label,
        color: series.color,
        value: finite(value)
          ? props.kind === "network"
            ? `${Math.round(value)} ms`
            : formatRate(value)
          : "—",
        loss: finite(loss) ? formatLoss(loss) : "—",
        failureLabel: series.failureLabel || "丢包",
      };
    }),
  };
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(async () => {
    await nextTick();
    if (plot !== current || !host.value || !tip.value || !tooltip.value) return;
    const width = tip.value.offsetWidth,
      height = tip.value.offsetHeight;
    const anchorX = current.over.offsetLeft + left,
      anchorY = current.over.offsetTop + top;
    const x = Math.max(
      7,
      Math.min(
        anchorX + 11 + width > host.value.clientWidth - 7 ? anchorX - width - 11 : anchorX + 11,
        host.value.clientWidth - width - 7,
      ),
    );
    const y = Math.max(7, Math.min(anchorY - height / 2, host.value.clientHeight - height - 7));
    tip.value.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  });
}
function render() {
  disposePlot();
  if (!host.value || !canvas.value || !usable.value.length) return;
  plot = new uPlot(
    chartOptions(usable.value, {
      kind: props.kind,
      width: Math.max(1, host.value.clientWidth),
      height: Math.max(160, host.value.clientHeight),
      hours: props.hours,
      layers: props.layers,
      onCursor: cursorChanged,
    }),
    alignSeries(usable.value),
    canvas.value,
  );
  plot.over.setAttribute("aria-label", "移动鼠标或触摸图表查看采样详情");
  observer = new ResizeObserver(() => {
    if (plot && host.value && host.value.clientWidth > 10 && host.value.clientHeight > 10)
      plot.setSize({ width: host.value.clientWidth, height: host.value.clientHeight });
  });
  observer.observe(host.value);
}
// The canvas library owns only its mount element; Vue owns the tooltip and empty state.
onMounted(render);
watch([() => props.series, () => props.hours, () => props.theme, () => props.layers], render, {
  flush: "post",
});
onScopeDispose(disposePlot);
</script>
<template>
  <div
    :id="id"
    ref="host"
    class="plot-host"
    :class="{ 'plot-host-network': kind === 'network' }"
    role="img"
    :aria-label="kind === 'network' ? '网络延迟与丢包历史图' : '网络速率历史图'"
  >
    <div ref="canvas" class="plot-canvas"></div>
    <div
      v-if="tooltip"
      ref="tip"
      class="plot-tooltip"
      :class="{ 'plot-tooltip-metric': kind === 'rate' }"
      role="status"
    >
      <time>{{ formatTime(tooltip.time, true) }}</time>
      <div class="plot-tooltip-list">
        <div
          v-for="(row, index) in tooltip.rows"
          :key="index"
          class="plot-tooltip-row"
          :class="{ 'is-single': kind === 'rate' }"
        >
          <span class="plot-tooltip-target"
            ><i :style="{ '--tooltip-color': row.color }"></i><b>{{ row.label }}</b></span
          >
          <span
            ><em v-if="kind === 'network'">延迟</em><b>{{ row.value }}</b></span
          >
          <span v-if="kind === 'network'"
            ><em>{{ row.failureLabel }}</em
            ><b>{{ row.loss }}</b></span
          >
        </div>
      </div>
    </div>
  </div>
  <div :id="emptyId" class="chart-empty" :class="{ 'is-hidden': usable.length }">
    {{ kind === "network" ? "暂无网络质量历史" : "暂无速率历史" }}
  </div>
</template>
<style scoped>
.plot-canvas {
  width: 100%;
  height: 100%;
}
</style>
