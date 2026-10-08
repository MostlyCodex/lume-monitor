<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { ChartPoint, ChartSeries, NetworkLayer, Theme } from "../types";
import { finite } from "../charts/series";
import { formatAxisTime, formatLoss, formatRate, formatTime } from "../domain/format";

const props = defineProps<{
  id: string;
  emptyId: string;
  series: ChartSeries[];
  kind: "network" | "rate";
  hours: number;
  theme: Theme;
  layers: readonly NetworkLayer[];
}>();

const usable = computed(() =>
  props.series.filter(
    (series) =>
      series.points.some((point) => finite(point.y)) ||
      (props.kind === "network" && series.lossPoints?.some((point) => finite(point.y))),
  ),
);
const showLines = computed(() => props.kind === "rate" || props.layers.includes("latency"));
const showLoss = computed(() => props.kind === "network" && props.layers.includes("loss"));

// 按容器实际宽度绘制、高度固定，避免手机上整张图等比缩小到无法阅读
const root = ref<HTMLElement | null>(null);
const width = ref(800);
const height = 240;
const padding = { top: 16, right: 16, bottom: 28, left: 64 };
const LOSS_BAND = 36;
let resizeObserver: ResizeObserver | undefined;
onMounted(() => {
  if (!root.value) return;
  resizeObserver = new ResizeObserver(([entry]) => {
    if (entry.contentRect.width > 0) width.value = Math.round(entry.contentRect.width);
  });
  resizeObserver.observe(root.value);
});
onBeforeUnmount(() => resizeObserver?.disconnect());

// 时间戳单位为秒
const bounds = computed(() => {
  let minX = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const s of usable.value) {
    for (const p of [...s.points, ...(s.lossPoints ?? [])]) {
      if (!finite(p.x)) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
    }
    for (const p of s.points) if (finite(p.y) && p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX) || !isFinite(maxX) || minX === maxX) {
    maxX = Date.now() / 1000;
    minX = maxX - props.hours * 3600;
  }
  if (!isFinite(maxY) || maxY <= 0) maxY = 10;
  return { minX, maxX, minY: 0, maxY: maxY * 1.15 };
});

function getX(val: number) {
  const { minX, maxX } = bounds.value;
  return (
    padding.left + ((val - minX) / (maxX - minX)) * (width.value - padding.left - padding.right)
  );
}

function getY(val: number) {
  const { minY, maxY } = bounds.value;
  return (
    height -
    padding.bottom -
    ((val - minY) / (maxY - minY)) * (height - padding.top - padding.bottom)
  );
}

function generateSmoothPath(points: ChartPoint[]): { linePath: string; areaPath: string } {
  const valid = points.filter((p): p is { x: number; y: number } => finite(p.x) && finite(p.y));
  if (valid.length === 0) return { linePath: "", areaPath: "" };
  if (valid.length === 1) {
    const x = getX(valid[0].x);
    const y = getY(valid[0].y);
    return { linePath: `M ${x} ${y} L ${x + 1} ${y}`, areaPath: "" };
  }

  let line = `M ${getX(valid[0].x)} ${getY(valid[0].y)}`;
  for (let i = 0; i < valid.length - 1; i++) {
    const x0 = getX(valid[i].x);
    const y0 = getY(valid[i].y);
    const x1 = getX(valid[i + 1].x);
    const y1 = getY(valid[i + 1].y);
    const mx = (x0 + x1) / 2;
    line += ` C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`;
  }

  const baseLineY = height - padding.bottom;
  const area = `${line} L ${getX(valid[valid.length - 1].x)} ${baseLineY} L ${getX(valid[0].x)} ${baseLineY} Z`;
  return { linePath: line, areaPath: area };
}

const renderedSeries = computed(() =>
  usable.value.map((s, idx) => ({
    ...s,
    gradientId: `grad-${props.id}-${idx}`,
    ...generateSmoothPath(s.points),
    lossBars: (s.lossPoints ?? [])
      .filter((p): p is { x: number; y: number } => finite(p.x) && finite(p.y) && p.y > 0)
      .map((p) => ({ x: getX(p.x), h: Math.max(2, (Math.min(p.y, 100) / 100) * LOSS_BAND) })),
  })),
);

const yTicks = computed(() => {
  const { maxY } = bounds.value;
  return [0, maxY * 0.33, maxY * 0.66, maxY].map((val) => ({
    y: getY(val),
    label: props.kind === "network" ? `${Math.round(val)} ms` : formatRate(val),
  }));
});

const xTicks = computed(() => {
  const { minX, maxX } = bounds.value;
  return [minX, minX + (maxX - minX) * 0.5, maxX].map((val) => ({
    x: getX(val),
    label: formatAxisTime(val, props.hours),
  }));
});

// 悬停 / 点按提示
const hoveredX = ref<number | null>(null);
const tooltip = ref<HTMLElement | null>(null);
const tooltipPos = ref({ left: 0, top: 0 });

async function onPointer(event: PointerEvent) {
  const svg = event.currentTarget as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  const relX = ((event.clientX - rect.left) / rect.width) * width.value;
  const clampedX = Math.max(padding.left, Math.min(width.value - padding.right, relX));
  const { minX, maxX } = bounds.value;
  hoveredX.value =
    minX +
    ((clampedX - padding.left) / (width.value - padding.left - padding.right)) * (maxX - minX);
  const x = event.clientX - rect.left,
    y = event.clientY - rect.top;
  await nextTick();
  // 提示框始终保持在图表区域内
  const box = tooltip.value,
    host = root.value;
  if (!box || !host) return;
  const w = box.offsetWidth,
    h = box.offsetHeight;
  const left = x + 14 + w > host.clientWidth ? x - 14 - w : x + 14;
  tooltipPos.value = {
    left: Math.max(4, Math.min(host.clientWidth - w - 4, left)),
    top: Math.max(4, Math.min(host.clientHeight - h - 4, y - h / 2)),
  };
}

function onPointerLeave(event: PointerEvent) {
  // 触屏点按后保留提示，鼠标移出才隐藏
  if (event.pointerType === "mouse") hoveredX.value = null;
}

function closest(points: ChartPoint[] | undefined, target: number) {
  let best: ChartPoint | undefined;
  for (const p of points ?? [])
    if (!best || Math.abs(p.x - target) < Math.abs(best.x - target)) best = p;
  return best;
}

const activeTooltipData = computed(() => {
  if (hoveredX.value === null) return null;
  const target = hoveredX.value;
  const rows = usable.value.map((s) => {
    const point = closest(s.points, target);
    const loss = closest(s.lossPoints, target);
    return {
      id: s.id,
      label: s.label,
      color: s.color,
      value:
        point && finite(point.y)
          ? props.kind === "network"
            ? `${Math.round(point.y)} ms`
            : formatRate(point.y)
          : "—",
      lossLabel: s.failureLabel || "丢包",
      loss: loss && finite(loss.y) ? formatLoss(loss.y) : "—",
    };
  });
  const anchor = closest(usable.value[0]?.points, target)?.x ?? target;
  return { time: formatTime(anchor, true), rows };
});
</script>

<template>
  <div :id="id" ref="root" class="history-chart relative w-full overflow-hidden select-none">
    <div v-if="usable.length" class="relative w-full">
      <svg
        class="block w-full touch-pan-y"
        :width="width"
        :height="height"
        :viewBox="`0 0 ${width} ${height}`"
        role="img"
        :aria-label="kind === 'network' ? '网络质量历史曲线' : '网络速率历史曲线'"
        @pointermove="onPointer"
        @pointerdown="onPointer"
        @pointerleave="onPointerLeave"
      >
        <defs>
          <linearGradient
            v-for="s in renderedSeries"
            :id="s.gradientId"
            :key="s.gradientId"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" :stop-color="s.color" stop-opacity="0.25" />
            <stop offset="100%" :stop-color="s.color" stop-opacity="0.0" />
          </linearGradient>
        </defs>

        <!-- 水平虚线网格 -->
        <g class="stroke-border" stroke-dasharray="3 3">
          <line
            v-for="(tick, idx) in yTicks"
            :key="idx"
            :x1="padding.left"
            :y1="tick.y"
            :x2="width - padding.right"
            :y2="tick.y"
          />
        </g>

        <!-- Y 轴标签 -->
        <g class="fill-muted-foreground text-[11px] font-mono">
          <text
            v-for="(tick, idx) in yTicks"
            :key="idx"
            :x="padding.left - 8"
            :y="tick.y + 4"
            text-anchor="end"
          >
            {{ tick.label }}
          </text>
        </g>

        <!-- X 轴时间标签 -->
        <g class="x-axis fill-muted-foreground text-[11px] font-mono">
          <text
            v-for="(tick, idx) in xTicks"
            :key="idx"
            :x="tick.x"
            :y="height - 8"
            :text-anchor="idx === 0 ? 'start' : idx === xTicks.length - 1 ? 'end' : 'middle'"
          >
            {{ tick.label }}
          </text>
        </g>

        <!-- 丢包 / 建连失败事件：自底部向上的细柱，高度对应失败比例 -->
        <g v-if="showLoss" class="loss-layer">
          <g v-for="s in renderedSeries" :key="`loss-${s.id}`" :fill="s.color" fill-opacity="0.7">
            <rect
              v-for="(bar, idx) in s.lossBars"
              :key="idx"
              :x="bar.x - 1.5"
              :y="height - padding.bottom - bar.h"
              width="3"
              :height="bar.h"
              rx="1"
            />
          </g>
        </g>

        <!-- 面积阴影与折线 -->
        <g v-if="showLines" class="line-layer">
          <g v-for="s in renderedSeries" :key="s.id">
            <path :d="s.areaPath" :fill="`url(#${s.gradientId})`" />
            <path
              :d="s.linePath"
              fill="none"
              :stroke="s.color"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </g>
        </g>

        <!-- 悬停指示垂线 -->
        <line
          v-if="hoveredX !== null"
          :x1="getX(hoveredX)"
          :y1="padding.top"
          :x2="getX(hoveredX)"
          :y2="height - padding.bottom"
          class="stroke-foreground/60"
          stroke-width="1"
          stroke-dasharray="2 2"
        />
      </svg>

      <div
        v-if="activeTooltipData"
        ref="tooltip"
        class="plot-tooltip pointer-events-none absolute z-20 min-w-[160px] max-w-[min(320px,calc(100%-8px))] rounded-lg border bg-popover p-2 text-xs text-popover-foreground shadow-md"
        :style="{ left: `${tooltipPos.left}px`, top: `${tooltipPos.top}px` }"
        role="status"
      >
        <time
          class="mb-1.5 block border-b border-border/40 pb-1 font-mono text-[11px] text-muted-foreground"
        >
          {{ activeTooltipData.time }}
        </time>
        <div class="space-y-1">
          <div
            v-for="row in activeTooltipData.rows"
            :key="row.id"
            class="plot-tooltip-row grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3"
          >
            <span class="flex min-w-0 items-center gap-1.5 font-medium">
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                :style="{ backgroundColor: row.color }"
              ></span>
              <span class="truncate">{{ row.label }}</span>
            </span>
            <span class="font-mono font-semibold tabular-nums">{{ row.value }}</span>
            <span v-if="kind === 'network'" class="font-mono tabular-nums text-muted-foreground">
              {{ row.lossLabel }} {{ row.loss }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 暂无数据空状态 -->
    <div
      v-else
      :id="emptyId"
      class="flex h-48 w-full flex-col items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground"
    >
      {{ kind === "network" ? "暂无网络质量历史" : "暂无速率历史" }}
    </div>
  </div>
</template>
