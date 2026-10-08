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
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";

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

const badgeVariant = computed(() => {
  if (severity.value === "healthy") return "healthy";
  if (severity.value === "warning") return "degraded";
  if (severity.value === "critical" || severity.value === "offline") return "critical";
  return "stale";
});

const rateSeries = computed<ChartSeries[]>(() => {
  void props.theme;
  const metrics = props.history?.metrics.filter((row) => row.node_id === props.node.id) ?? [];
  return [
    {
      id: "download",
      label: "下载",
      color: "#0ea5e9", // Sky-500
      points: metrics.map((row) => ({ x: row.timestamp, y: row.network_rx_rate_bps })),
    },
    {
      id: "upload",
      label: "上传",
      color: "#f59e0b", // Amber-500
      points: metrics.map((row) => ({ x: row.timestamp, y: row.network_tx_rate_bps })),
    },
  ];
});
</script>

<template>
  <section id="node-detail" class="space-y-6" aria-live="polite" :aria-busy="loading">
    <!-- 顶部导航与时间切换 -->
    <div class="flex flex-wrap items-center justify-between gap-4">
      <Button
        id="detail-back"
        variant="outline"
        size="sm"
        class="h-8 gap-1.5 text-xs coarse:h-11"
        type="button"
        @click="emit('back')"
      >
        <span>←</span> 返回节点列表
      </Button>

      <div
        id="detail-range-switch"
        class="inline-flex rounded-lg bg-muted p-1 text-muted-foreground select-none"
        aria-label="历史时间范围"
      >
        <button
          v-for="range in ranges"
          :key="range.hours"
          type="button"
          :data-hours="range.hours"
          :class="[
            'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-all coarse:min-h-10',
            hours === range.hours
              ? 'bg-background text-foreground shadow-sm'
              : 'hover:bg-background/50 hover:text-foreground',
          ]"
          :aria-pressed="hours === range.hours"
          @click="emit('range', range.hours)"
        >
          {{ range.label }}
        </button>
      </div>
    </div>

    <!-- 节点主卡片 Hero -->
    <Card id="detail-hero" class="border-border/80 bg-card p-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div class="flex items-center gap-4">
          <div
            class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/30"
          >
            <CountryFlag :country="node.country" class="scale-125" />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span
                class="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider"
              >
                {{ node.role || "VPS NODE" }}
              </span>
            </div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground mt-0.5">
              {{ node.label }}
            </h1>
            <p class="text-xs text-muted-foreground font-mono mt-1">
              {{
                [node.region, node.country, `更新于 ${formatTime(node.received_at)}`]
                  .filter(Boolean)
                  .join(" · ")
              }}
            </p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <Badge
            :variant="badgeVariant"
            class="node-status py-1 px-3 text-xs font-normal"
            :data-severity="severity"
          >
            <span class="relative flex h-2 w-2 mr-1.5">
              <span
                v-if="badgeVariant === 'healthy'"
                class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
              ></span>
              <span
                class="relative inline-flex rounded-full h-2 w-2"
                :class="{
                  'bg-emerald-500': badgeVariant === 'healthy',
                  'bg-amber-500': badgeVariant === 'degraded',
                  'bg-rose-500': badgeVariant === 'critical',
                  'bg-zinc-400': badgeVariant === 'stale',
                }"
              ></span>
            </span>
            {{ severityLabel(severity) }}
          </Badge>

          <ServiceList :services="node.services ?? []" />

          <Badge variant="outline" class="font-mono text-xs py-1 px-2.5 bg-muted/20">
            运行 {{ formatUptime(node.metrics.uptime_seconds) }}
          </Badge>
        </div>
      </div>
    </Card>

    <!-- 加载状态 -->
    <div
      v-if="loading || error"
      id="detail-loading"
      class="flex h-32 w-full items-center justify-center rounded-xl border border-dashed border-border bg-card/50 text-sm text-muted-foreground font-mono"
      role="status"
    >
      {{ error || `正在读取 ${node.label} 的历史数据…` }}
    </div>

    <!-- 详情主内容 -->
    <div v-if="!loading" id="detail-content" class="space-y-6">
      <!-- 网络质量探针与图表 -->
      <NetworkQuality
        :node="node"
        :history="history"
        :fleet-history="fleetHistory"
        :hours="hours"
        :theme="theme"
      />

      <!-- 网络活动速率图表 -->
      <Card class="border-border/80 bg-card">
        <CardHeader class="p-5 pb-3">
          <div class="flex items-center justify-between">
            <div>
              <span
                class="text-[11px] font-mono text-muted-foreground uppercase tracking-wider block"
                >NETWORK ACTIVITY</span
              >
              <CardTitle class="text-base font-semibold mt-0.5">网络吞吐速率</CardTitle>
            </div>
            <div class="flex items-center gap-3 text-xs font-mono">
              <span class="flex items-center gap-1.5 text-sky-500 font-medium">
                <span class="h-2 w-2 rounded-full bg-sky-500"></span> 下载
              </span>
              <span class="flex items-center gap-1.5 text-amber-500 font-medium">
                <span class="h-2 w-2 rounded-full bg-amber-500"></span> 上传
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent class="p-5 pt-2">
          <HistoryChart
            id="traffic-plot"
            empty-id="traffic-empty"
            :series="rateSeries"
            kind="rate"
            :hours="hours"
            :theme="theme"
            :layers="[]"
          />
        </CardContent>
      </Card>

      <!-- 节点规格与事件明细 -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <NodeFacts :node="node" />
        <NodeEvents :events="history?.annotations ?? []" :hours="hours" />
      </div>
    </div>
  </section>
</template>
