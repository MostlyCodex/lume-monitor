<script setup lang="ts">
import { computed } from "vue";
import type {
  EnergyBucket,
  HistorySnapshot,
  MetricKind,
  NodeSnapshot,
  Probe,
  Tone,
} from "../types";
import {
  aggregateMetricEnergy,
  displayProbeLabel,
  latencyTone,
  lossTone,
  windowLoss,
} from "../domain/probes";
import { formatLoss, formatTime } from "../domain/format";

const props = defineProps<{
  node: NodeSnapshot;
  probe: Probe;
  history: HistorySnapshot | null;
  now: number;
}>();

const latencyBuckets = computed(() =>
  aggregateMetricEnergy(props.node.id, props.probe, "latency", props.history, props.now),
);
const lossBuckets = computed(() =>
  aggregateMetricEnergy(props.node.id, props.probe, "loss", props.history, props.now),
);

// 延迟取最新一轮；丢包取与格栅相同口径的 24 小时加权值，没有历史时退回最新一轮
const latency = computed(() =>
  props.probe.success && props.probe.duration_ms != null ? props.probe.duration_ms : null,
);
const loss = computed(
  () => windowLoss(lossBuckets.value) ?? props.probe.packet_loss_percent ?? null,
);

const metrics = computed(() => [
  {
    kind: "latency" as MetricKind,
    label: "延迟",
    value: latency.value == null ? "— ms" : `${Math.round(latency.value)} ms`,
    tone: latencyTone(latency.value) as Tone | "empty",
    buckets: latencyBuckets.value,
  },
  {
    kind: "loss" as MetricKind,
    label: "丢包",
    value: loss.value == null ? "—" : formatLoss(loss.value),
    tone: (loss.value == null ? "empty" : lossTone(loss.value)) as Tone | "empty",
    buckets: lossBuckets.value,
  },
]);

function bucketTitle(bucket: EnergyBucket, kind: MetricKind) {
  const time = formatTime(bucket.start, true);
  if (bucket.empty) return `${time} · 无采样`;
  if (kind === "latency") {
    return bucket.value == null
      ? `${time} · 无响应`
      : `${time} · 延迟 ${Math.round(bucket.value)} ms`;
  }
  const lost = bucket.attempted
    ? ` · 丢失 ${Math.round(Math.max(0, bucket.attempted - (bucket.successful ?? 0)))}/${Math.round(bucket.attempted)} 次握手`
    : "";
  return `${time} · 丢包 ${formatLoss(bucket.value)}${lost}`;
}

// 绿色数值保持正文色，只有偏离正常时才着色
const textClass: Record<Tone | "empty", string> = {
  green: "text-foreground",
  blue: "text-status-info",
  yellow: "text-status-warn",
  red: "text-status-bad",
  empty: "text-muted-foreground",
};

const cellClass: Record<Tone | "empty", string> = {
  green: "bg-status-ok",
  blue: "bg-status-info",
  yellow: "bg-status-warn",
  red: "bg-status-bad",
  empty: "bg-muted",
};
</script>

<template>
  <!-- 延迟、丢包两列等分卡片宽度，每列 24 格（每格 1 小时）随列宽拉伸、格高固定；
       上行：延迟列左侧为探测名称、右侧为延迟值，丢包列右侧为丢包率；下行为两条格栅 -->
  <div class="probe-row grid grid-cols-2 items-end gap-x-4 gap-y-1 text-xs">
    <div class="col-start-1 row-start-1 flex min-w-0 items-baseline justify-between gap-1.5">
      <span
        class="probe-name min-w-0 truncate text-[11px] leading-none text-muted-foreground"
        :title="displayProbeLabel(probe)"
      >
        {{ displayProbeLabel(probe) }}
      </span>
      <span
        class="shrink-0 font-medium leading-none tabular-nums"
        :class="textClass[metrics[0].tone]"
        data-value="latency"
      >
        {{ metrics[0].value }}
      </span>
    </div>
    <span
      class="col-start-2 row-start-1 justify-self-end font-medium leading-none tabular-nums"
      :class="textClass[metrics[1].tone]"
      data-value="loss"
    >
      {{ metrics[1].value }}
    </span>

    <!-- 格子等宽填满所在列，格高与间距固定 -->
    <div
      v-for="metric in metrics"
      :key="metric.kind"
      class="row-start-2 flex min-w-0 gap-[2px]"
      :class="metric.kind === 'loss' ? 'col-start-2' : 'col-start-1'"
      :data-metric="metric.kind"
      :aria-label="`24 小时${metric.label}`"
    >
      <div
        v-for="(bucket, idx) in metric.buckets"
        :key="bucket.start || idx"
        class="energy-cell h-3.5 min-w-[2px] flex-1 rounded-[1px]"
        :class="cellClass[bucket.tone]"
        :data-tone="bucket.tone"
        :title="bucketTitle(bucket, metric.kind)"
      ></div>
    </div>
  </div>
</template>
