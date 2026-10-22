<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { ChartPoint, ChartSeries, Theme } from "../types";
import { finite } from "../charts/series";
import { formatAxisTime, formatLoss, formatRate, formatTime } from "../domain/format";

// 延迟（ms）、丢包率（%）和速率（B/s）共用同一种折线图
const props = defineProps<{
  id: string;
  emptyId: string;
  emptyText: string;
  series: ChartSeries[];
  kind: "latency" | "loss" | "rate";
  hours: number;
  theme: Theme;
}>();

const usable = computed(() =>
  props.series.filter((series) => series.points.some((point) => finite(point.y))),
);

// 按容器实际宽度绘制、高度固定，避免手机上整张图等比缩小到无法阅读
const root = ref<HTMLElement | null>(null);
const width = ref(800);
const height = 240;
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
const xRange = computed(() => {
  let minX = Infinity,
    maxX = -Infinity;
  for (const s of usable.value)
    for (const p of s.points)
      if (finite(p.x)) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
      }
  if (!isFinite(minX) || !isFinite(maxX) || minX === maxX) {
    maxX = Date.now() / 1000;
    minX = maxX - props.hours * 3600;
  }
  return { minX, maxX };
});

// 每个绘制点至少占 MIN_POINT_SPACING 像素：分钟级数据按时间槽合并取平均，
// 避免把逐分钟的抖动画成锯齿。悬停提示读取的也是合并后的点，与曲线一致。
const MIN_POINT_SPACING = 4;
function mergePoints(points: ChartPoint[]): ChartPoint[] {
  const { minX, maxX } = xRange.value;
  const slots = Math.max(2, Math.floor((width.value - 64) / MIN_POINT_SPACING));
  if (points.length <= slots) return points;
  const slotSeconds = (maxX - minX) / slots;
  const merged: ChartPoint[] = [];
  let slot = -1,
    sumX = 0,
    sumY = 0,
    count = 0,
    missing = false;
  const flush = () => {
    if (count) merged.push({ x: sumX / count, y: sumY / count });
    else if (missing) merged.push({ x: minX + (slot + 0.5) * slotSeconds, y: null });
  };
  for (const p of points) {
    if (!finite(p.x)) continue;
    const index = Math.min(slots - 1, Math.floor((p.x - minX) / slotSeconds));
    if (index !== slot) {
      flush();
      slot = index;
      sumX = sumY = count = 0;
      missing = false;
    }
    if (finite(p.y)) {
      sumX += p.x;
      sumY += p.y;
      count += 1;
    } else missing = true;
  }
  flush();
  return merged;
}

// 相邻两点间隔超过常规间隔的 1.5 倍（或任一点缺值）即视为缺失，曲线在此断开
function gapSeconds(points: ChartPoint[]): number {
  const steps: number[] = [];
  for (let i = 1; i < points.length; i++) steps.push(points[i].x - points[i - 1].x);
  steps.sort((a, b) => a - b);
  return (steps[Math.floor(steps.length / 2)] ?? Infinity) * 1.5;
}

const displayed = computed(() =>
  usable.value.map((s) => {
    const points = mergePoints(s.points);
    return { ...s, points, gap: gapSeconds(points) };
  }),
);

// 数据本身的纵向范围（含留白），最终坐标轴再按整数刻度向外取整
const dataBounds = computed(() => {
  const { minX, maxX } = xRange.value;
  let minY = Infinity,
    maxY = -Infinity;
  for (const s of displayed.value)
    for (const p of s.points)
      if (finite(p.y)) {
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
  if (!isFinite(maxY)) return { minX, maxX, minY: 0, maxY: 10 };
  // 丢包率从 0 起画，至少显示到 5%，最多 100%
  if (props.kind === "loss")
    return { minX, maxX, minY: 0, maxY: Math.min(100, Math.max(5, maxY * 1.15)) };
  // 其余纵轴按数据范围自适应（上下各留 15%），不强制从 0 开始，避免数值接近的曲线挤成一团；
  // 延迟纵轴至少跨最大值的一半，1–2 ms 的抖动不会被放大成锯齿
  if (props.kind === "latency" && maxY - minY < maxY * 0.5) {
    const middle = (maxY + minY) / 2;
    minY = Math.max(0, middle - maxY * 0.25);
    maxY = minY + maxY * 0.5;
  }
  const span = maxY - minY || Math.max(1, maxY * 0.1);
  return {
    minX,
    maxX,
    minY: Math.max(0, minY - span * 0.15),
    maxY: maxY + span * 0.15,
  };
});

// 纵轴刻度带单位（ms / % / B/s…），数字与单位之间不留空格以节省窄屏宽度；
// 速率按最大值换算为 B/s、KB/s、MB/s… 中的一个，整轴单位一致
const RATE_UNITS = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"];
const rateUnitIndex = computed(() => {
  if (props.kind !== "rate") return 0;
  let index = 0;
  while (dataBounds.value.maxY / 1024 ** index >= 1024 && index < RATE_UNITS.length - 1) index += 1;
  return index;
});
const axisUnit = computed(() =>
  props.kind === "latency" ? "ms" : props.kind === "loss" ? "%" : RATE_UNITS[rateUnitIndex.value],
);

// 刻度只取整数：间距取 1、2、2.5、5×10ⁿ 中最接近四等分的值（至少 1 个单位），
// 上下边界向外取整到刻度上；带小数的精确数值见悬停 / 点按提示
const tickValues = computed(() => {
  const divisor = 1024 ** rateUnitIndex.value;
  const minY = dataBounds.value.minY / divisor;
  const maxY = dataBounds.value.maxY / divisor;
  const rough = Math.max(1, (maxY - minY) / 4);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  // 2.5 只在 ≥ 10 的量级使用（25、250…），保证刻度仍是整数
  const factors = magnitude >= 10 ? [1, 2, 2.5, 5] : [1, 2, 5];
  const step = magnitude * (factors.find((n) => n * magnitude >= rough) ?? 10);
  const first = Math.floor(minY / step) * step;
  const last = Math.max(first + step, Math.ceil(maxY / step) * step);
  const ticks: number[] = [];
  for (let tick = first; tick <= last; tick += step) ticks.push(tick * divisor);
  return ticks;
});
const bounds = computed(() => {
  const ticks = tickValues.value;
  return { ...dataBounds.value, minY: ticks[0], maxY: ticks[ticks.length - 1] };
});
function tickLabel(val: number) {
  return `${Math.round(val / 1024 ** rateUnitIndex.value)}${axisUnit.value}`;
}
// 12px Geist 下各字符的近似宽度（数字为 tabular-nums 等宽）；SVG 文字不会换行，
// 纵轴宽度按最长刻度估算，保证单位完整显示、不被左边缘截断
const GLYPH_WIDTH: Record<string, number> = { m: 10.5, M: 10, "%": 10.5, "/": 5, s: 6.5 };
function labelWidth(label: string) {
  let total = 0;
  for (const char of label)
    total += GLYPH_WIDTH[char] ?? (/[0-9.]/.test(char) ? 7.2 : /[A-Z]/.test(char) ? 8.5 : 7);
  return total;
}
const padding = computed(() => {
  const longest = Math.max(...tickValues.value.map((val) => labelWidth(tickLabel(val))));
  return {
    top: 16,
    right: compact.value ? 8 : 16,
    bottom: 28,
    left: Math.max(24, Math.ceil(longest) + 8),
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

// 单调三次插值（Fritsch–Butland，与 d3 / Recharts 的 monotone 同类）：曲线经过每个点时保留斜率，
// 不会在数据点处出现小平台，也不会越过相邻两点的取值范围，丢包率不会被画成负数
function monotonePath(xs: number[], ys: number[]): string {
  const n = xs.length;
  if (n === 1) return `M ${xs[0]} ${ys[0]} L ${xs[0] + 1} ${ys[0]}`;
  const slopes = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i] || 1));
  const tangents = xs.map((_x, i) => {
    if (i === 0) return slopes[0];
    if (i === n - 1) return slopes[n - 2];
    const [a, b] = [slopes[i - 1], slopes[i]];
    if (a * b <= 0) return 0;
    const [h0, h1] = [xs[i] - xs[i - 1], xs[i + 1] - xs[i]];
    return (3 * (h0 + h1)) / ((2 * h1 + h0) / a + (h1 + 2 * h0) / b);
  });
  let path = `M ${xs[0]} ${ys[0]}`;
  for (let i = 0; i < n - 1; i++) {
    const third = (xs[i + 1] - xs[i]) / 3;
    path += ` C ${xs[i] + third} ${ys[i] + tangents[i] * third}, ${xs[i + 1] - third} ${ys[i + 1] - tangents[i + 1] * third}, ${xs[i + 1]} ${ys[i + 1]}`;
  }
  return path;
}

function generateSmoothPath(
  points: ChartPoint[],
  gap: number,
): { linePath: string; areaPath: string } {
  const runs: ChartPoint[][] = [];
  let run: ChartPoint[] = [];
  for (const p of points) {
    const previous = run[run.length - 1];
    if (!finite(p.x) || !finite(p.y) || (previous && p.x - previous.x > gap)) {
      if (run.length) runs.push(run);
      run = finite(p.x) && finite(p.y) ? [p] : [];
    } else run.push(p);
  }
  if (run.length) runs.push(run);

  const baseLineY = height - padding.value.bottom;
  let linePath = "",
    areaPath = "";
  for (const segment of runs) {
    const xs = segment.map((p) => getX(p.x));
    const ys = segment.map((p) => getY(p.y as number));
    const line = monotonePath(xs, ys);
    linePath += `${line} `;
    if (segment.length > 1)
      areaPath += `${line} L ${xs[xs.length - 1]} ${baseLineY} L ${xs[0]} ${baseLineY} Z `;
  }
  return { linePath: linePath.trim(), areaPath: areaPath.trim() };
}

const renderedSeries = computed(() =>
  displayed.value.map((s, idx) => ({
    ...s,
    gradientId: `grad-${props.id}-${idx}`,
    ...generateSmoothPath(s.points, s.gap),
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

function formatValue(value: number) {
  if (props.kind === "latency") return `${value.toFixed(1)} ms`;
  return props.kind === "loss" ? formatLoss(value) : formatRate(value);
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
  const rows = displayed.value.map((s) => {
    const point = closest(s.points, target);
    return {
      id: s.id,
      label: s.label,
      color: s.color,
      value: point && finite(point.y) ? formatValue(point.y) : "—",
    };
  });
  const anchor = closest(displayed.value[0]?.points, target)?.x ?? target;
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
        :aria-label="
          { latency: '延迟历史曲线', loss: '丢包率历史曲线', rate: '网络速率历史曲线' }[kind]
        "
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

        <!-- Y 轴标签（带单位） -->
        <g class="y-axis fill-muted-foreground text-xs tabular-nums">
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

        <!-- 面积阴影与折线 -->
        <g class="line-layer">
          <g v-for="s in renderedSeries" :key="s.id">
            <!-- 多条曲线只画线（填充叠加会混色）；速率图保留淡填充 -->
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
            class="plot-tooltip-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"
          >
            <span class="flex min-w-0 items-center gap-1.5 font-medium">
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                :style="{ backgroundColor: row.color }"
              ></span>
              <span class="truncate">{{ row.label }}</span>
            </span>
            <span class="tabular-nums font-semibold">{{ row.value }}</span>
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
      {{ emptyText }}
    </div>
  </div>
</template>
