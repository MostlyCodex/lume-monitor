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
const LOSS_BAND = 36;
// 窄屏（手机）下收窄右侧留白
const compact = computed(() => width.value < 640);
let resizeObserver: ResizeObserver | undefined;
// 触屏点按图表以外的地方时收起提示
function dismissOutside(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) hoveredX.value = null;
}
onMounted(() => {
  document.addEventListener("pointerdown", dismissOutside, true);
  if (!root.value) return;
  resizeObserver = new ResizeObserver(([entry]) => {
    if (entry.contentRect.width > 0) width.value = Math.round(entry.contentRect.width);
  });
  resizeObserver.observe(root.value);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", dismissOutside, true);
  resizeObserver?.disconnect();
});

// 时间戳单位为秒
const bounds = computed(() => {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const s of usable.value) {
    for (const p of [...s.points, ...(s.lossPoints ?? [])]) {
      if (!finite(p.x)) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
    }
    for (const p of s.points) {
      if (!finite(p.y)) continue;
      if (p.y > maxY) maxY = p.y;
      if (p.y < minY) minY = p.y;
    }
  }
  if (!isFinite(minX) || !isFinite(maxX) || minX === maxX) {
    maxX = Date.now() / 1000;
    minX = maxX - props.hours * 3600;
  }
  // 纵轴按数据范围自适应（上下各留 15%），不强制从 0 开始，避免数值接近的曲线挤成一团
  if (!isFinite(maxY)) return { minX, maxX, minY: 0, maxY: 10 };
  const span = maxY - minY || Math.max(1, maxY * 0.1);
  return {
    minX,
    maxX,
    minY: Math.max(0, minY - span * 0.15),
    maxY: maxY + span * 0.15,
  };
});

// 纵轴刻度只写数字（不带单位）；速率按最大值换算为 B/KB/MB… 的数值，带单位的完整数值见悬停提示
const axisScale = computed(() => {
  if (props.kind === "network") return 1;
  let index = 0;
  while (bounds.value.maxY / 1024 ** index >= 1024 && index < 4) index += 1;
  return 1024 ** index;
});
function tickLabel(val: number) {
  const scaled = val / axisScale.value;
  // 小数位按相邻刻度间距决定：刻度贴得很近时多保留小数，避免出现重复的刻度值
  const step = (bounds.value.maxY - bounds.value.minY) / 3 / axisScale.value;
  const digits = step >= 10 ? 0 : step >= 1 ? (scaled < 10 ? 1 : 0) : step >= 0.1 ? 1 : 2;
  return scaled.toFixed(digits);
}
const tickValues = computed(() => {
  const { minY, maxY } = bounds.value;
  return [0, 1, 2, 3].map((step) => minY + ((maxY - minY) * step) / 3);
});
const padding = computed(() => {
  const longest = Math.max(...tickValues.value.map((val) => tickLabel(val).length));
  // 12px Geist 数字约 7.2px 一个字符（tabular-nums）；纵轴宽度随最长刻度变化
  return {
    top: 16,
    right: compact.value ? 8 : 16,
    bottom: 28,
    left: Math.max(24, Math.ceil(longest * 7.2) + 8),
  };
});

function getX(val: number) {
  const { minX, maxX } = bounds.value;
  return (
    padding.value.left +
    ((val - minX) / (maxX - minX)) * (width.value - padding.value.left - padding.value.right)
  );
}

function getY(val: number) {
  const { minY, maxY } = bounds.value;
  return (
    height -
    padding.value.bottom -
    ((val - minY) / (maxY - minY)) * (height - padding.value.top - padding.value.bottom)
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

  const baseLineY = height - padding.value.bottom;
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

const yTicks = computed(() =>
  tickValues.value.map((val) => ({ y: getY(val), label: tickLabel(val) })),
);

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
  const { left, right } = padding.value;
  const clampedX = Math.max(left, Math.min(width.value - right, relX));
  const { minX, maxX } = bounds.value;
  hoveredX.value = minX + ((clampedX - left) / (width.value - left - right)) * (maxX - minX);
  const x = event.clientX - rect.left,
    y = event.clientY - rect.top;
  await nextTick();
  // 提示框始终保持在图表区域内
  const box = tooltip.value,
    host = root.value;
  if (!box || !host) return;
  const w = box.offsetWidth,
    h = box.offsetHeight;
  const preferred = x + 14 + w > host.clientWidth ? x - 14 - w : x + 14;
  tooltipPos.value = {
    left: Math.max(4, Math.min(host.clientWidth - w - 4, preferred)),
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
    <div v-if="usable.length && (showLines || showLoss)" class="relative w-full">
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
            <stop offset="0%" :stop-color="s.color" stop-opacity="0.2" />
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

        <!-- Y 轴标签；窄屏时单位单独标在轴顶 -->
        <g class="fill-muted-foreground text-xs tabular-nums">
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
        <g class="x-axis fill-muted-foreground text-xs tabular-nums">
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
            <!-- 多条延迟曲线只画线（填充叠加会混色）；速率图保留淡填充 -->
            <path v-if="kind === 'rate'" :d="s.areaPath" :fill="`url(#${s.gradientId})`" />
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
          class="mb-1.5 block border-b border-border pb-1 tabular-nums text-xs text-muted-foreground"
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
            <span class="tabular-nums font-semibold">{{ row.value }}</span>
            <span v-if="kind === 'network'" class="tabular-nums text-muted-foreground">
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
      class="flex h-48 w-full flex-col items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground"
    >
      {{
        kind === "rate"
          ? "暂无速率历史"
          : usable.length
            ? "未选择要显示的曲线或事件"
            : "暂无网络质量历史"
      }}
    </div>
  </div>
</template>
