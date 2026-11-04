<script setup lang="ts">
import { computed } from "vue";
import type { HistorySnapshot, NodeSnapshot, Probe } from "../types";
import {
  aggregateMetricEnergy,
  displayProbeLabel,
  shortProbeLabel,
  ribbonCells,
  windowLoss,
  type RibbonCell,
} from "../domain/probes";
import { formatLoss, formatTime } from "../domain/format";

const props = defineProps<{
  node: NodeSnapshot;
  probe: Probe;
  history: HistorySnapshot | null;
  now: number;
}>();

const lossBuckets = computed(() =>
  aggregateMetricEnergy(props.node.id, props.probe, "loss", props.history, props.now),
);
const cells = computed(() =>
  ribbonCells(
    aggregateMetricEnergy(props.node.id, props.probe, "latency", props.history, props.now),
    lossBuckets.value,
  ),
);

// 延迟取最新一轮，数值不着色；异常只由光带的颜色表达
const latency = computed(() =>
  props.probe.success && props.probe.duration_ms != null
    ? Math.round(props.probe.duration_ms)
    : null,
);

// 丢包率取光带覆盖的 24 小时，按每次采样加权；同样不着色
const loss = computed(() => windowLoss(lossBuckets.value));

function cellTitle(cell: RibbonCell) {
  const time = formatTime(cell.start, true);
  if (cell.state === "empty") return `${time} · 无采样`;
  if (cell.latency == null) return `${time} · 无响应`;
  const loss = cell.loss ? ` · 丢包 ${formatLoss(cell.loss)}` : "";
  return `${time} · ${Math.round(cell.latency)} ms${loss}`;
}

const cellClass: Record<RibbonCell["state"], string> = {
  normal: "bg-bar",
  warn: "bg-status-warn",
  bad: "bg-status-bad",
  empty: "bg-transparent ring-1 ring-inset ring-border",
};
</script>

<template>
  <!-- 名称 | 24 小时光带（每柱 1 小时）| 当前延迟 | 24 小时丢包率，四项等距。
       列宽来自卡片的共享网格（subgrid）：名称、数值列按本卡最宽的内容收紧，光带占满其余空间 -->
  <div class="probe-row col-span-full grid h-[22px] grid-cols-subgrid items-center">
    <span
      class="probe-name truncate text-[13px] text-muted-foreground"
      :title="displayProbeLabel(probe)"
    >
      {{ shortProbeLabel(probe) }}
    </span>
    <div
      class="flex h-full items-end justify-between gap-[2px]"
      data-metric="latency"
      :aria-label="`${displayProbeLabel(probe)} 过去 24 小时`"
    >
      <i
        v-for="(cell, idx) in cells"
        :key="cell.start || idx"
        class="energy-cell block min-w-0.5 max-w-[7px] flex-1 rounded-[2px]"
        :class="cellClass[cell.state]"
        :style="{ height: `${Math.round(cell.height * 100)}%` }"
        :data-tone="cell.state"
        :title="cellTitle(cell)"
      ></i>
    </div>
    <span class="text-right text-[15px] font-medium tabular-nums leading-none" data-value="latency">
      {{ latency ?? "—" }}<small class="ml-0.5 text-[11px] font-normal text-faint">ms</small>
    </span>
    <span
      class="text-right text-[13px] tabular-nums leading-none text-muted-foreground"
      data-value="loss"
      :title="`过去 24 小时丢包率`"
    >
      {{ loss == null ? "—" : formatLoss(loss) }}
    </span>
  </div>
</template>
