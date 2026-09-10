<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import type { ChartSeries, HistorySnapshot, NetworkLayer, NodeSnapshot, Theme } from "../types";
import {
  allProbes,
  currentProbeSeverity,
  displayProbeLabel,
  probeColorTone,
  PROBE_COLOR_VARIABLES,
} from "../domain/probes";
import { formatLoss } from "../domain/format";
import { finite } from "../charts/series";
import { cssColor } from "../charts/theme";
const HistoryChart = defineAsyncComponent(() => import("./HistoryChart.vue"));
const props = defineProps<{
  node: NodeSnapshot;
  history: HistorySnapshot | null;
  fleetHistory: HistorySnapshot | null;
  hours: number;
  theme: Theme;
}>();
const selected = ref(new Set<string>());
const layers = ref<NetworkLayer[]>(["latency", "loss"]);
const probes = computed(() => allProbes(props.node));
watch(
  () => props.node.id,
  () => {
    selected.value = new Set(probes.value.map((probe) => probe.name));
  },
  { immediate: true },
);
const hasTcp = computed(() => probes.value.some((probe) => probe.kind === "tcp"));
const cards = computed(() => {
  const summaries = new Map(
    props.history?.probe_summaries?.map((summary) => [summary.probe_name, summary]),
  );
  return probes.value.map((probe) => {
    const summary = summaries.get(probe.name);
    const currentLatency =
      probe.success && finite(probe.duration_ms) ? `${Math.round(probe.duration_ms)} ms` : "— ms";
    const average = finite(summary?.latency_average_ms)
      ? `${Math.round(summary.latency_average_ms)} ms`
      : currentLatency;
    const failure = formatLoss(
      summary?.sample_failure_percent ??
        probe.packet_loss_percent ??
        probe.sample_failure_percent ??
        100,
    );
    const failureLabel = probe.kind === "tcp" ? "建连失败" : "区间丢包";
    const label = displayProbeLabel(probe);
    return {
      name: probe.name,
      label,
      average,
      failure,
      failureLabel,
      tone: probeColorTone(probe),
      severity: currentProbeSeverity(probe, props.node.id, props.fleetHistory),
      description: `${label}，平均延迟 ${average}，${failureLabel} ${failure}`,
    };
  });
});
const series = computed<ChartSeries[]>(() => {
  // Reading the theme makes CSS-derived canvas colors reactive without a global redraw loop.
  void props.theme;
  return probes.value
    .filter((probe) => selected.value.has(probe.name))
    .map((probe) => {
      const rows =
        props.history?.probes.filter(
          (row) => row.node_id === props.node.id && row.probe_name === probe.name,
        ) ?? [];
      return {
        label: displayProbeLabel(probe),
        color: cssColor(PROBE_COLOR_VARIABLES[probeColorTone(probe)]),
        failureLabel: probe.kind === "tcp" ? "建连失败" : "丢包",
        points: rows.map((row) => ({ x: row.timestamp, y: row.latency_ms })),
        lossPoints: rows.map((row) => ({
          x: row.timestamp,
          y: (probe.kind === "tcp" ? row.sample_failure_percent : row.packet_loss_percent) ?? null,
        })),
      };
    });
});
function toggleProbe(name: string) {
  if (selected.value.has(name)) selected.value.delete(name);
  else selected.value.add(name);
}
function toggleLayer(layer: NetworkLayer) {
  if (!layers.value.includes(layer)) layers.value = [...layers.value, layer];
  else if (layers.value.length > 1) layers.value = layers.value.filter((value) => value !== layer);
}
</script>
<template>
  <section class="detail-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">NETWORK QUALITY</p>
        <h2 id="network-section-title">{{ hasTcp ? "延迟与可达性" : "延迟与丢包" }}</h2>
      </div>
    </div>
    <div class="probe-picker">
      <div class="probe-picker-head">
        <div id="detail-probe-actions" class="probe-picker-actions" aria-label="批量选择探测目标">
          <button
            type="button"
            data-probe-action="all"
            :class="{
              'is-active': probes.length > 0 && probes.every((probe) => selected.has(probe.name)),
            }"
            @click="selected = new Set(probes.map((probe) => probe.name))"
          >
            全选
          </button>
          <button
            type="button"
            data-probe-action="none"
            :class="{ 'is-active': !selected.size }"
            @click="selected = new Set()"
          >
            清空
          </button>
        </div>
      </div>
      <div id="detail-probe-summary" class="detail-probe-summary">
        <button
          v-for="card in cards"
          :key="card.name"
          type="button"
          class="detail-probe-card"
          :class="[
            `probe-tone-${card.tone}`,
            `is-${card.severity}`,
            { 'is-active': selected.has(card.name) },
          ]"
          :data-detail-probe="card.name"
          :aria-pressed="selected.has(card.name)"
          :aria-label="card.description"
          @click="toggleProbe(card.name)"
        >
          <i class="detail-probe-swatch" aria-hidden="true"></i
          ><span class="detail-probe-label"
            ><strong>{{ card.label }}</strong></span
          ><span title="平均延迟">{{ card.average }}</span
          ><span :title="card.failureLabel">{{ card.failure }}</span>
        </button>
        <div v-if="!cards.length" class="probe-empty">此节点未配置通信探测</div>
      </div>
    </div>
    <div class="network-chart-toolbar">
      <div id="network-layer-switch" class="network-layer-switch" aria-label="网络图层">
        <button
          type="button"
          data-network-layer="latency"
          :class="{ 'is-active': layers.includes('latency') }"
          :aria-pressed="layers.includes('latency')"
          @click="toggleLayer('latency')"
        >
          <i class="legend-line"></i>延迟
        </button>
        <button
          type="button"
          data-network-layer="loss"
          :class="{ 'is-active': layers.includes('loss') }"
          :aria-pressed="layers.includes('loss')"
          @click="toggleLayer('loss')"
        >
          <i class="legend-bars"></i
          ><span id="network-failure-layer-label">{{ hasTcp ? "失败事件" : "丢包事件" }}</span>
        </button>
      </div>
      <p>
        <i class="legend-line"></i>实线 = 延迟（ms）<i class="legend-bars"></i
        ><span id="network-failure-legend">{{
          hasTcp ? "竖条 = 丢包或建连失败；颜色越实，比例越高" : "竖条 = 丢包；颜色越实，比例越高"
        }}</span>
      </p>
    </div>
    <article class="chart-card network-chart-card glass-panel">
      <div class="chart-title">
        <div>
          <strong>线路质量历史</strong
          ><span id="network-chart-subtitle">{{
            hasTcp
              ? "Latency line · ICMP loss / TCP connect failure"
              : "Latency line · Packet-loss event"
          }}</span>
        </div>
        <span id="network-chart-state"
          >{{ series.length }} 条线路 · {{ history?.probes.length ?? 0 }} 个区间采样</span
        >
      </div>
      <HistoryChart
        id="network-plot"
        empty-id="network-empty"
        :series="series"
        kind="network"
        :hours="hours"
        :theme="theme"
        :layers="layers"
      />
    </article>
  </section>
</template>
