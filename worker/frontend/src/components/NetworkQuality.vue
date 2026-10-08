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
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

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
  void props.theme;
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
    const failureValue =
      summary?.sample_failure_percent ??
      probe.packet_loss_percent ??
      probe.sample_failure_percent ??
      100;
    const failure = formatLoss(failureValue);
    const failureLabel = probe.kind === "tcp" ? "建连失败" : "区间丢包";
    const label = displayProbeLabel(probe);
    return {
      name: probe.name,
      label,
      average,
      failure,
      failed: Number(failureValue) > 0,
      failureLabel,
      color: cssColor(PROBE_COLOR_VARIABLES[probeColorTone(probe)]),
      tone: probeColorTone(probe),
      severity: currentProbeSeverity(probe, props.node.id, props.fleetHistory),
      description: `${label}，平均延迟 ${average}，${failureLabel} ${failure}`,
    };
  });
});

const series = computed<ChartSeries[]>(() => {
  void props.theme;
  return probes.value
    .filter((probe) => selected.value.has(probe.name))
    .map((probe) => {
      const rows =
        props.history?.probes.filter(
          (row) => row.node_id === props.node.id && row.probe_name === probe.name,
        ) ?? [];
      return {
        id: probe.name,
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
  <Card class="border-border/80 bg-card">
    <CardHeader class="p-5 pb-3">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span class="text-[11px] font-mono text-muted-foreground uppercase tracking-wider block"
            >NETWORK QUALITY</span
          >
          <CardTitle class="text-base font-semibold mt-0.5">{{
            hasTcp ? "延迟与可达性监控" : "延迟与丢包监控"
          }}</CardTitle>
        </div>

        <div id="detail-probe-actions" class="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="h-7 px-2.5 text-xs font-mono coarse:h-11 coarse:px-4"
            data-probe-action="all"
            :class="{
              'bg-accent text-accent-foreground':
                probes.length > 0 && probes.every((p) => selected.has(p.name)),
            }"
            @click="selected = new Set(probes.map((p) => p.name))"
          >
            全选
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="h-7 px-2.5 text-xs font-mono coarse:h-11 coarse:px-4"
            data-probe-action="none"
            :class="{ 'bg-accent text-accent-foreground': !selected.size }"
            @click="selected = new Set()"
          >
            清空
          </Button>
        </div>
      </div>
    </CardHeader>

    <CardContent class="p-5 pt-2 space-y-4">
      <!-- 目标探针选择网格 -->
      <div id="detail-probe-summary" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <button
          v-for="card in cards"
          :key="card.name"
          type="button"
          class="detail-probe-card flex flex-col gap-1.5 p-3 rounded-lg border text-left transition-all select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          :class="[
            selected.has(card.name)
              ? 'border-primary/50 bg-primary/5 shadow-sm'
              : 'border-border/50 bg-muted/20 opacity-70 hover:opacity-100 hover:bg-muted/30',
          ]"
          :data-detail-probe="card.name"
          :aria-pressed="selected.has(card.name)"
          :aria-label="card.description"
          @click="toggleProbe(card.name)"
        >
          <div class="flex items-center justify-between gap-2 text-xs">
            <span class="flex min-w-0 items-center gap-1.5">
              <span
                class="detail-probe-swatch h-2.5 w-2.5 shrink-0 rounded-full"
                :style="{ backgroundColor: card.color }"
                aria-hidden="true"
              ></span>
              <strong class="truncate font-semibold text-foreground">{{ card.label }}</strong>
            </span>
            <Badge
              :variant="card.failed ? 'degraded' : 'healthy'"
              class="text-[10px] font-mono px-1 py-0 font-normal"
            >
              {{ card.failure }}
            </Badge>
          </div>
          <div class="flex items-center justify-between text-xs text-muted-foreground font-mono">
            <span>平均延迟</span>
            <span class="text-foreground font-semibold">{{ card.average }}</span>
          </div>
        </button>

        <div
          v-if="!cards.length"
          class="col-span-full py-4 text-center text-xs text-muted-foreground"
        >
          此节点未配置通信探测
        </div>
      </div>

      <!-- 图表工具条 -->
      <div
        class="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/40 text-xs text-muted-foreground"
      >
        <div id="network-layer-switch" class="inline-flex rounded-md bg-muted p-0.5">
          <button
            type="button"
            class="px-2.5 py-1 rounded-sm text-xs font-medium transition-all coarse:min-h-11 coarse:px-4"
            data-network-layer="latency"
            :aria-pressed="layers.includes('latency')"
            :class="
              layers.includes('latency')
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            "
            @click="toggleLayer('latency')"
          >
            延迟曲线
          </button>
          <button
            type="button"
            class="px-2.5 py-1 rounded-sm text-xs font-medium transition-all coarse:min-h-11 coarse:px-4"
            data-network-layer="loss"
            :aria-pressed="layers.includes('loss')"
            :class="
              layers.includes('loss')
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            "
            @click="toggleLayer('loss')"
          >
            {{ hasTcp ? "失败事件" : "丢包事件" }}
          </button>
        </div>

        <div class="text-[11px] font-mono flex items-center gap-3">
          <span>实线 = 延迟 (ms)</span>
          <span class="text-muted-foreground/80">{{
            hasTcp ? "建连失败或丢包事件" : "丢包分布事件"
          }}</span>
        </div>
      </div>

      <!-- 历史图表 -->
      <HistoryChart
        id="network-plot"
        empty-id="network-empty"
        :series="series"
        kind="network"
        :hours="hours"
        :theme="theme"
        :layers="layers"
      />
    </CardContent>
  </Card>
</template>
