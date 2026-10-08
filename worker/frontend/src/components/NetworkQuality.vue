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
  layers.value = layers.value.includes(layer)
    ? layers.value.filter((value) => value !== layer)
    : [...layers.value, layer];
}
</script>

<template>
  <Card>
    <CardHeader class="grid-cols-[1fr_auto] items-center">
      <CardTitle>{{ hasTcp ? "延迟与可达性" : "延迟与丢包" }}</CardTitle>
      <div id="detail-probe-actions" class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          class="h-7 px-2 text-xs sm:h-8 sm:px-3 sm:text-sm"
          data-probe-action="all"
          @click="selected = new Set(probes.map((p) => p.name))"
        >
          全选
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="h-7 px-2 text-xs sm:h-8 sm:px-3 sm:text-sm"
          data-probe-action="none"
          @click="selected = new Set()"
        >
          清空
        </Button>
      </div>
    </CardHeader>

    <CardContent class="space-y-4">
      <!-- 探测点选择：仅颜色标识与名称；平均延迟和失败率保留在 aria-label 中 -->
      <div id="detail-probe-summary" class="flex flex-wrap gap-1.5">
        <button
          v-for="card in cards"
          :key="card.name"
          type="button"
          class="detail-probe-card inline-flex h-7 max-w-full select-none items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-[color,box-shadow,opacity] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-8 sm:px-2.5 sm:text-sm"
          :class="[selected.has(card.name) ? 'bg-accent text-accent-foreground' : 'opacity-50']"
          :data-detail-probe="card.name"
          :aria-pressed="selected.has(card.name)"
          :aria-label="card.description"
          @click="toggleProbe(card.name)"
        >
          <span
            class="detail-probe-swatch h-2 w-2 shrink-0 rounded-full"
            :style="{ backgroundColor: card.color }"
            aria-hidden="true"
          ></span>
          <span class="truncate">{{ card.label }}</span>
        </button>

        <div v-if="!cards.length" class="w-full py-4 text-center text-sm text-muted-foreground">
          此节点未配置通信探测
        </div>
      </div>

      <!-- 图表工具条 -->
      <div class="flex items-center border-t pt-4">
        <!-- 切换按钮无边框、无悬停样式：触屏点按后悬停状态会残留，状态只由底色区分 -->
        <div id="network-layer-switch" class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium transition-[color,box-shadow] sm:h-8 sm:px-2.5 sm:text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            data-network-layer="latency"
            :aria-pressed="layers.includes('latency')"
            :class="
              layers.includes('latency')
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground'
            "
            @click="toggleLayer('latency')"
          >
            延迟曲线
          </button>
          <button
            type="button"
            class="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium transition-[color,box-shadow] sm:h-8 sm:px-2.5 sm:text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            data-network-layer="loss"
            :aria-pressed="layers.includes('loss')"
            :class="
              layers.includes('loss') ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
            "
            @click="toggleLayer('loss')"
          >
            {{ hasTcp ? "失败事件" : "丢包事件" }}
          </button>
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
