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
  if (!loss || loss.raw == null || !props.probe.success) return "text-rose-500";
  return loss.raw > 0 ? "text-amber-500" : "text-muted-foreground";
});

function cellBg(bucket: EnergyBucket) {
  if (bucket.empty) return "bg-muted";
  if (bucket.severity === "healthy") return "bg-emerald-500";
  if (bucket.severity === "warning") return "bg-amber-400";
  return "bg-rose-500";
}
</script>

<template>
  <div class="probe-row grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-1.5 text-xs">
    <span class="truncate font-medium text-foreground" :title="displayProbeLabel(probe)">
      {{ displayProbeLabel(probe) }}
    </span>

    <!-- 24H 状态格栅：格子固定尺寸，不随窗口宽度缩放 -->
    <div class="flex shrink-0 gap-[2px]">
      <div
        v-for="(bucket, idx) in metrics[0]?.buckets"
        :key="bucket.start || idx"
        class="energy-cell h-3.5 w-[5px] rounded-[1.5px]"
        :class="cellBg(bucket)"
        :title="bucketTitle(bucket, 'latency')"
      ></div>
    </div>

    <div class="flex items-center gap-2 font-mono text-[11px] tabular-nums">
      <span class="w-12 text-right text-foreground">{{ metrics[0]?.value }}</span>
      <span class="w-9 text-right" :class="lossTone">{{ metrics[1]?.value }}</span>
    </div>
  </div>
</template>
