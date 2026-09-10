<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import type { ChartSeries, HistoryHours, HistorySnapshot, NodeSnapshot, Theme } from "../types";
import { nodeSeverity, severityLabel } from "../domain/probes";
import { formatTime, formatUptime } from "../domain/format";
import { cssColor } from "../charts/theme";
import CountryFlag from "./CountryFlag.vue";
import ServiceList from "./ServiceList.vue";
import NetworkQuality from "./NetworkQuality.vue";
import NodeFacts from "./NodeFacts.vue";
import NodeEvents from "./NodeEvents.vue";
const HistoryChart = defineAsyncComponent(() => import("./HistoryChart.vue"));
const props = defineProps<{
  node: NodeSnapshot;
  history: HistorySnapshot | null;
  fleetHistory: HistorySnapshot | null;
  hours: HistoryHours;
  theme: Theme;
  loading: boolean;
  error: string;
}>();
const emit = defineEmits<{ back: []; range: [hours: HistoryHours] }>();
const ranges: { hours: HistoryHours; label: string }[] = [
  { hours: 6, label: "6H" },
  { hours: 24, label: "24H" },
  { hours: 168, label: "7D" },
  { hours: 720, label: "30D" },
  { hours: 2160, label: "90D" },
];
const severity = computed(() => nodeSeverity(props.node, props.fleetHistory));
const rateSeries = computed<ChartSeries[]>(() => {
  void props.theme;
  const metrics = props.history?.metrics.filter((row) => row.node_id === props.node.id) ?? [];
  return [
    {
      label: "下载",
      color: cssColor("--cyan"),
      points: metrics.map((row) => ({ x: row.timestamp, y: row.network_rx_rate_bps })),
    },
    {
      label: "上传",
      color: cssColor("--amber"),
      points: metrics.map((row) => ({ x: row.timestamp, y: row.network_tx_rate_bps })),
    },
  ];
});
</script>
<template>
  <section id="node-detail" class="detail-view" aria-live="polite" :aria-busy="loading">
    <div class="detail-nav">
      <button id="detail-back" class="button button-ghost" type="button" @click="emit('back')">
        ← 返回节点
      </button>
      <div id="detail-range-switch" class="range-switch" aria-label="历史时间范围">
        <button
          v-for="range in ranges"
          :key="range.hours"
          type="button"
          :data-hours="range.hours"
          :class="{ 'is-active': hours === range.hours }"
          :aria-pressed="hours === range.hours"
          @click="emit('range', range.hours)"
        >
          {{ range.label }}
        </button>
      </div>
    </div>
    <section id="detail-hero" class="detail-hero glass-panel">
      <div class="detail-identity">
        <div class="detail-flag" role="img" :aria-label="node.country || '未知国家'">
          <CountryFlag :country="node.country" />
        </div>
        <div>
          <p class="eyebrow">{{ node.role || "VPS NODE" }}</p>
          <h1>{{ node.label }}</h1>
          <p>
            {{
              [node.region, node.country, `更新于 ${formatTime(node.received_at)}`]
                .filter(Boolean)
                .join(" · ")
            }}
          </p>
        </div>
      </div>
      <div class="detail-status-side">
        <div class="detail-status-copy">
          <span class="node-status" :class="`is-${severity}`"
            ><i class="node-live-dot"></i>{{ severityLabel(severity) }}</span
          ><ServiceList :services="node.services ?? []" /><span class="detail-uptime"
            >持续运行 {{ formatUptime(node.metrics.uptime_seconds) }}</span
          >
        </div>
      </div>
    </section>
    <div
      id="detail-loading"
      class="detail-loading glass-panel"
      :class="{ 'is-hidden': !loading && !error }"
      role="status"
    >
      {{ error || `正在读取 ${node.label} 的历史数据…` }}
    </div>
    <div v-if="!loading" id="detail-content" class="detail-content">
      <NetworkQuality
        :node="node"
        :history="history"
        :fleet-history="fleetHistory"
        :hours="hours"
        :theme="theme"
      />
      <section class="detail-section">
        <div class="section-heading">
          <div>
            <p class="eyebrow">NETWORK ACTIVITY</p>
            <h2>网络速率</h2>
          </div>
        </div>
        <div class="detail-chart-grid is-single">
          <article class="chart-card glass-panel">
            <div class="chart-title">
              <div>
                <strong>速率历史</strong>
                <div class="chart-series-key" aria-label="曲线颜色">
                  <span class="is-download"><i></i>下载</span
                  ><span class="is-upload"><i></i>上传</span>
                </div>
              </div>
            </div>
            <HistoryChart
              id="traffic-plot"
              empty-id="traffic-empty"
              :series="rateSeries"
              kind="rate"
              :hours="hours"
              :theme="theme"
              :layers="[]"
            />
          </article>
        </div>
      </section>
      <div class="detail-bottom-grid">
        <NodeFacts :node="node" /><NodeEvents :events="history?.annotations ?? []" :hours="hours" />
      </div>
    </div>
  </section>
</template>
