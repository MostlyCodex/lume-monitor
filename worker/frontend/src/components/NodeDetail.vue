<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import type { ChartSeries, HistoryHours, HistorySnapshot, NodeSnapshot, Theme } from "../types";
import { nodeSeverity, severityLabel } from "../domain/probes";
import { formatTime, formatUptime } from "../domain/format";
import { cssColor } from "../charts/theme";
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
      color: cssColor("--probe-telecom"),
      points: metrics.map((row) => ({ x: row.timestamp, y: row.network_rx_rate_bps })),
    },
    {
      id: "upload",
      label: "上传",
      color: cssColor("--probe-mobile"),
      points: metrics.map((row) => ({ x: row.timestamp, y: row.network_tx_rate_bps })),
    },
  ];
});
</script>

<template>
  <section id="node-detail" class="space-y-4" aria-live="polite" :aria-busy="loading">
    <!-- 顶部导航与时间切换 -->
    <div class="flex flex-wrap items-center justify-between gap-4">
      <Button id="detail-back" variant="outline" size="sm" @click="emit('back')">
        <span aria-hidden="true">←</span> 返回节点列表
      </Button>

      <!-- shadcn Tabs 样式；未选中项不设悬停样式，避免触屏点按后状态残留 -->
      <div
        id="detail-range-switch"
        class="inline-flex h-9 w-fit select-none items-center rounded-lg bg-muted p-[3px] text-muted-foreground"
        aria-label="历史时间范围"
      >
        <button
          v-for="range in ranges"
          :key="range.hours"
          type="button"
          :data-hours="range.hours"
          class="inline-flex h-full items-center justify-center whitespace-nowrap rounded-md border border-transparent px-2.5 text-sm font-medium transition-[color,box-shadow] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          :class="
            hours === range.hours
              ? 'bg-background text-foreground shadow-sm dark:border-input dark:bg-white/[0.045]'
              : 'text-muted-foreground'
          "
          :aria-pressed="hours === range.hours"
          @click="emit('range', range.hours)"
        >
          {{ range.label }}
        </button>
      </div>
    </div>

    <!-- 节点概要 -->
    <Card id="detail-hero" class="gap-0 px-4 sm:gap-0 sm:px-6">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div class="flex min-w-0 flex-col gap-1.5">
          <span class="text-sm text-muted-foreground">{{ node.role || "VPS 节点" }}</span>
          <h1 class="truncate text-xl font-semibold leading-none tracking-tight sm:text-2xl">
            {{ node.label }}
          </h1>
          <p class="text-sm tabular-nums text-muted-foreground">
            {{
              [node.region, node.country, `更新于 ${formatTime(node.received_at)}`]
                .filter(Boolean)
                .join(" · ")
            }}
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <Badge :variant="badgeVariant" class="node-status" :data-severity="severity">
            {{ severityLabel(severity) }}
          </Badge>
          <ServiceList :services="node.services ?? []" />
          <Badge variant="outline" class="tabular-nums">
            运行 {{ formatUptime(node.metrics.uptime_seconds) }}
          </Badge>
        </div>
      </div>
    </Card>

    <!-- 加载状态 -->
    <div
      v-if="loading || error"
      id="detail-loading"
      class="flex h-32 w-full items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground"
      role="status"
    >
      {{ error || `正在读取 ${node.label} 的历史数据…` }}
    </div>

    <!-- 详情主内容 -->
    <div v-if="!loading" id="detail-content" class="space-y-4">
      <NetworkQuality
        :node="node"
        :history="history"
        :fleet-history="fleetHistory"
        :hours="hours"
        :theme="theme"
      />

      <!-- 网络吞吐速率 -->
      <Card>
        <CardHeader class="grid-cols-[1fr_auto] items-center">
          <CardTitle>网络吞吐速率</CardTitle>
          <div class="flex items-center gap-3 text-sm">
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
            :series="rateSeries"
            kind="rate"
            :hours="hours"
            :theme="theme"
            :layers="[]"
          />
        </CardContent>
      </Card>

      <!-- 节点规格与事件明细 -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <NodeFacts :node="node" />
        <NodeEvents :events="history?.annotations ?? []" :hours="hours" />
      </div>
    </div>
  </section>
</template>
