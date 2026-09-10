<script setup lang="ts">
import { computed } from "vue";
import type { EnergyBucket, HistorySnapshot, MetricKind, NodeSnapshot, Probe } from "../types";
import {
  aggregateMetricEnergy,
  currentProbeSeverity,
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
const severity = computed(() => currentProbeSeverity(props.probe, props.node.id, props.history));
const metrics = computed(() =>
  (["latency", "loss"] as MetricKind[]).map((kind) => {
    const raw =
      kind === "latency"
        ? props.probe.duration_ms
        : (props.probe.packet_loss_percent ?? props.probe.sample_failure_percent);
    return {
      kind,
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
</script>
<template>
  <div class="probe-row" :class="`is-${severity}`">
    <div class="probe-target">
      <i></i><span :title="displayProbeLabel(probe)">{{ displayProbeLabel(probe) }}</span>
    </div>
    <div class="probe-metrics">
      <div
        v-for="metric in metrics"
        :key="metric.kind"
        class="probe-metric"
        :class="[`is-${metric.kind}`, `is-${metric.severity}`]"
      >
        <div class="probe-metric-head">
          <span>{{ metric.label }}</span
          ><strong>{{ metric.value }}</strong>
        </div>
        <div
          class="energy-strip"
          :class="`is-${metric.kind}`"
          :aria-label="`${displayProbeLabel(probe)} 最近 24 小时${metric.label}`"
        >
          <i
            v-for="(bucket, index) in metric.buckets"
            :key="bucket.start"
            class="energy-cell"
            :class="[
              `is-${bucket.empty ? 'empty' : bucket.severity}`,
              { 'is-latest': index === metric.buckets.length - 1 },
            ]"
            :title="bucketTitle(bucket, metric.kind)"
          ></i>
        </div>
      </div>
    </div>
  </div>
</template>
