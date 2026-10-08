<script setup lang="ts">
import { computed } from "vue";
import type { EnergyBucket, HistorySnapshot, MetricKind, NodeSnapshot, Probe } from "../types";
import {
  aggregateMetricEnergy,
  displayProbeLabel,
  historicalRows,
  probeMetricSeverity,
} from "../domain/probes";
import { formatLoss, formatTime } from "../domain/format";

const props = defineProps<{
  node: NodeSnapshot;
  probe: Probe;
  history: HistorySnapshot | null;
  now: number;
}>();

const metrics = computed(() =>
  (["latency", "loss"] as MetricKind[]).map((kind) => {
    const raw =
      kind === "latency"
        ? props.probe.duration_ms
        : (props.probe.packet_loss_percent ?? props.probe.sample_failure_percent);
    return {
      kind,
      raw,
      label: kind === "latency" ? "延迟" : "丢包",
      value:
        kind === "latency"
          ? props.probe.success && raw != null
            ? `${Math.round(raw)} ms`
            : "— ms"
          : formatLoss(raw ?? 100),
      severity: probeMetricSeverity(
        kind,
        raw,
        props.probe,
        historicalRows(props.node.id, props.probe.name, props.history),
        props.probe.success,
        props.probe.complete,
      ),
      buckets: aggregateMetricEnergy(props.node.id, props.probe, kind, props.history, props.now),
    };
  }),
);

function bucketTitle(bucket: EnergyBucket, kind: MetricKind) {
  const time = formatTime(bucket.start, true);
  if (bucket.empty) return `${time} · 无采样`;
  if (kind === "latency") return `${time} · 延迟 ${Math.round(bucket.value ?? 0)} ms`;
  const packets = bucket.attempted
    ? ` · 丢失 ${Math.round(Math.max(0, bucket.attempted - (bucket.successful ?? 0)))}/${Math.round(bucket.attempted)} 包`
    : "";
  return `${time} · 丢包 ${formatLoss(bucket.value)}${packets}${bucket.severeFiveMinuteLoss ? " · 含5分钟严重丢包" : ""}`;
}

const lossTone = computed(() => {
  const loss = metrics.value[1];
  if (!loss || loss.raw == null || !props.probe.success) return "text-status-bad";
  return loss.raw > 0 ? "text-status-warn" : "text-foreground";
});

function cellBg(bucket: EnergyBucket) {
  if (bucket.empty) return "bg-muted";
  if (bucket.severity === "healthy") return "bg-status-ok";
  if (bucket.severity === "warning") return "bg-status-warn";
  return "bg-status-bad";
}
</script>

<template>
  <!-- 名称列最宽 4.5rem（手机）/ 5rem（电脑），空间不足时只压缩名称，两条格栅宽度固定，三列两端对齐、间距均分。
       不依赖内容宽度或 subgrid，Safari 与 Chrome 排版一致。上行为数值（标在各自格栅右上方），
       下行为名称与两条格栅 -->
  <div
    class="probe-row grid grid-cols-[minmax(0,4.5rem)_auto_auto] items-center justify-between gap-y-1.5 text-xs sm:grid-cols-[minmax(0,5rem)_auto_auto]"
  >
    <span
      class="col-start-1 row-start-2 min-w-0 truncate text-sm leading-none"
      :title="displayProbeLabel(probe)"
    >
      {{ displayProbeLabel(probe) }}
    </span>
    <span
      v-for="metric in metrics"
      :key="`value-${metric.kind}`"
      class="row-start-1 justify-self-end text-xs font-medium leading-none tabular-nums"
      :class="
        metric.kind === 'loss' ? ['col-start-3', lossTone] : ['col-start-2', 'text-foreground']
      "
    >
      {{ metric.value }}
    </span>

    <!-- 格子固定尺寸，不随窗口宽度缩放 -->
    <div
      v-for="metric in metrics"
      :key="metric.kind"
      class="row-start-2 flex gap-[2px]"
      :class="metric.kind === 'loss' ? 'col-start-3' : 'col-start-2'"
      :data-metric="metric.kind"
      :aria-label="`24 小时${metric.label}`"
    >
      <div
        v-for="(bucket, idx) in metric.buckets"
        :key="bucket.start || idx"
        class="energy-cell h-3.5 w-1 shrink-0 rounded-[1px]"
        :class="cellBg(bucket)"
        :title="bucketTitle(bucket, metric.kind)"
      ></div>
    </div>
  </div>
</template>
