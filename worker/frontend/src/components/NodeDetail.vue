<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import type { ChartSeries, HistoryHours, HistorySnapshot, NodeSnapshot, Theme } from "../types";
import { formatRate, formatUptime } from "../domain/format";
import { trafficSummary } from "../domain/traffic";
import { nodeRegion } from "../domain/nodes";
import { cssColor } from "../charts/theme";
import ServiceList from "./ServiceList.vue";
import NetworkQuality from "./NetworkQuality.vue";
import NodeFacts from "./NodeFacts.vue";
import NodeEvents from "./NodeEvents.vue";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";

const HistoryChart = defineAsyncComponent(() => import("./HistoryChart.vue"));

const props = defineProps<{
  node: NodeSnapshot;
  history: HistorySnapshot | null;
  hours: HistoryHours;
  theme: Theme;
  loading: boolean;
  error: string;
}>();

const emit = defineEmits<{ back: []; range: [hours: HistoryHours] }>();

const ranges: { hours: HistoryHours; label: string }[] = [
  { hours: 6, label: "6 小时" },
  { hours: 24, label: "24 小时" },
  { hours: 168, label: "7 天" },
  { hours: 720, label: "30 天" },
  { hours: 2160, label: "90 天" },
];

const online = computed(() => props.node.online && !props.node.data_error);
const traffic = computed(() => trafficSummary(props.node.metrics));
const stats = computed(() => {
  const { metrics } = props.node;
  const percent = (value?: number | null) =>
    Number.isFinite(value) ? `${Math.round(Number(value))}%` : "—";
  return [
    { label: "CPU", value: percent(metrics.cpu_percent) },
    { label: "内存", value: percent(metrics.memory_used_percent) },
    { label: "磁盘", value: percent(metrics.disk_used_percent) },
    { label: "下载速率", value: formatRate(metrics.network_rx_rate_bps) },
    { label: traffic.value.label, value: traffic.value.total },
  ];
});

const rateSeries = computed<ChartSeries[]>(() => {
  void props.theme;
  const metrics = props.history?.metrics.filter((row) => row.node_id === props.node.id) ?? [];
  return [
    {
      id: "download",
      label: "下载",
      color: cssColor("--chart-download"),
      points: metrics.map((row) => ({ x: row.timestamp, y: row.network_rx_rate_bps })),
    },
    {
      id: "upload",
      label: "上传",
      color: cssColor("--chart-upload"),
      points: metrics.map((row) => ({ x: row.timestamp, y: row.network_tx_rate_bps })),
    },
  ];
});
</script>

<template>
  <section id="node-detail" class="space-y-5" aria-live="polite" :aria-busy="loading">
    <!-- 返回与时间范围 -->
    <div class="flex flex-wrap items-center justify-between gap-4">
      <button
        id="detail-back"
        type="button"
        class="rounded-md py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        @click="emit('back')"
      >
        <span aria-hidden="true">←</span> 返回节点列表
      </button>

      <!-- 未选中项不设悬停样式，避免触屏点按后状态残留 -->
      <div
        id="detail-range-switch"
        class="glass inline-flex h-9 w-fit select-none items-center gap-0.5 rounded-[10px] p-[3px]"
        aria-label="历史时间范围"
      >
        <button
          v-for="range in ranges"
          :key="range.hours"
          type="button"
          :data-hours="range.hours"
          class="inline-flex h-full items-center justify-center whitespace-nowrap rounded-[7px] px-2.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:px-3"
          :class="
            hours === range.hours
              ? 'bg-[var(--glass-hover)] font-medium text-foreground shadow-[inset_0_0_0_1px_var(--glass-edge)]'
              : 'text-muted-foreground'
          "
          :aria-pressed="hours === range.hours"
          @click="emit('range', range.hours)"
        >
          {{ range.label }}
        </button>
      </div>
    </div>

    <!-- 节点概要：名称 | 地区，右侧在线时长；服务状态；关键数值。手机上整块内缩，与下方卡片内容对齐 -->
    <header id="detail-hero" class="flex flex-col gap-5 px-4 pb-1 pt-1 sm:px-0">
      <div class="flex min-w-0 flex-col gap-3">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div class="flex min-w-0 max-w-full items-center gap-3.5">
            <h1
              class="min-w-0 truncate text-[26px] font-semibold leading-tight tracking-tight sm:text-[34px]"
            >
              {{ node.label }}
            </h1>
            <template v-if="nodeRegion(node)">
              <span class="h-5 w-px shrink-0 bg-border sm:h-6" aria-hidden="true"></span>
              <span class="shrink-0 text-sm text-muted-foreground sm:text-base">
                {{ nodeRegion(node) }}
              </span>
            </template>
          </div>
          <span
            class="ml-auto inline-flex shrink-0 items-center gap-2 text-sm text-muted-foreground"
          >
            <span
              class="size-[7px] rounded-full"
              :class="online ? 'bg-brand' : 'bg-muted-foreground/50'"
              aria-hidden="true"
            ></span>
            <span class="node-status" :data-online="online">
              {{ online ? `在线 ${formatUptime(node.metrics.uptime_seconds)}` : "下线" }}
            </span>
          </span>
        </div>
        <ServiceList :services="node.services ?? []" />
      </div>

      <!-- 五项始终同一行：手机上缩小字号并两端分布 -->
      <dl class="flex justify-between gap-x-2 sm:justify-start sm:gap-x-8">
        <div v-for="stat in stats" :key="stat.label" class="flex min-w-0 flex-col">
          <dt class="whitespace-nowrap text-xs text-muted-foreground">{{ stat.label }}</dt>
          <dd class="whitespace-nowrap text-sm font-medium sm:text-xl">{{ stat.value }}</dd>
        </div>
      </dl>
    </header>

    <!-- 加载状态 -->
    <div
      v-if="loading || error"
      id="detail-loading"
      class="glass flex h-32 w-full items-center justify-center rounded-2xl text-sm text-muted-foreground"
      role="status"
    >
      {{ error || `正在读取 ${node.label} 的历史数据…` }}
    </div>

    <!-- 详情主内容 -->
    <div v-if="!loading" id="detail-content" class="space-y-5">
      <NetworkQuality :node="node" :history="history" :hours="hours" :theme="theme" />

      <!-- 网络速率 -->
      <Card>
        <CardHeader class="grid-cols-[1fr_auto] items-center">
          <CardTitle>网络速率</CardTitle>
          <div class="flex items-center gap-4 text-[13px]">
            <span
              v-for="item in rateSeries"
              :key="item.id"
              class="flex items-center gap-1.5 text-muted-foreground"
            >
              <span class="size-2 rounded-full" :style="{ backgroundColor: item.color }"></span>
              {{ item.label }}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <HistoryChart
            id="traffic-plot"
            empty-id="traffic-empty"
            empty-text="暂无速率历史"
            :series="rateSeries"
            kind="rate"
            :hours="hours"
            :theme="theme"
          />
        </CardContent>
      </Card>

      <!-- 节点规格与事件明细 -->
      <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <NodeFacts :node="node" />
        <NodeEvents :events="history?.annotations ?? []" :hours="hours" />
      </div>
    </div>
  </section>
</template>
