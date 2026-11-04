<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import type { ChartSeries, HistorySnapshot, NodeSnapshot, Probe, Theme } from "../types";
import {
  allProbes,
  displayProbeLabel,
  probeColorTone,
  PROBE_COLOR_VARIABLES,
} from "../domain/probes";
import { cssColor } from "../charts/theme";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";

const HistoryChart = defineAsyncComponent(() => import("./HistoryChart.vue"));

const props = defineProps<{
  node: NodeSnapshot;
  history: HistorySnapshot | null;
  hours: number;
  theme: Theme;
}>();

const selected = ref(new Set<string>());
const probes = computed(() => allProbes(props.node));

watch(
  () => props.node.id,
  () => {
    selected.value = new Set(probes.value.map((probe) => probe.name));
  },
  { immediate: true },
);

function color(probe: Probe) {
  void props.theme;
  return cssColor(PROBE_COLOR_VARIABLES[probeColorTone(probe)]);
}

const chips = computed(() =>
  probes.value.map((probe) => ({
    name: probe.name,
    label: displayProbeLabel(probe),
    color: color(probe),
  })),
);

function seriesFor(list: Probe[], value: "latency_ms" | "packet_loss_percent"): ChartSeries[] {
  return list
    .filter((probe) => selected.value.has(probe.name))
    .map((probe) => ({
      id: probe.name,
      label: displayProbeLabel(probe),
      color: color(probe),
      points: (props.history?.probes ?? [])
        .filter((row) => row.node_id === props.node.id && row.probe_name === probe.name)
        .map((row) => ({ x: row.timestamp, y: row[value] ?? null })),
    }));
}

const latencySeries = computed(() => seriesFor(probes.value, "latency_ms"));
const lossSeries = computed(() => seriesFor(probes.value, "packet_loss_percent"));

function emptyText(list: Probe[], series: ChartSeries[], name: string) {
  return list.length && !series.length ? "未选择要显示的线路" : `暂无${name}历史`;
}

function toggleProbe(name: string) {
  if (selected.value.has(name)) selected.value.delete(name);
  else selected.value.add(name);
}
</script>

<template>
  <Card>
    <CardHeader class="grid-cols-[1fr_auto] items-center gap-3">
      <CardTitle>线路延迟</CardTitle>
      <div id="detail-probe-actions" class="flex items-center gap-1 text-[13px]">
        <button
          type="button"
          class="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          data-probe-action="all"
          @click="selected = new Set(probes.map((p) => p.name))"
        >
          全选
        </button>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          data-probe-action="none"
          @click="selected = new Set()"
        >
          清空
        </button>
      </div>
    </CardHeader>

    <CardContent class="space-y-4">
      <!-- 线路选择：同时作用于延迟曲线和下方的丢包时段 -->
      <div id="detail-probe-summary" class="flex flex-wrap gap-1">
        <button
          v-for="chip in chips"
          :key="chip.name"
          type="button"
          class="detail-probe-card inline-flex h-7 max-w-full select-none items-center gap-1.5 rounded-lg px-2.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          :class="
            selected.has(chip.name)
              ? 'bg-[var(--glass-hover)] text-foreground shadow-[inset_0_0_0_1px_var(--glass-edge)]'
              : 'text-faint'
          "
          :data-detail-probe="chip.name"
          :aria-pressed="selected.has(chip.name)"
          @click="toggleProbe(chip.name)"
        >
          <span
            class="detail-probe-swatch size-2 shrink-0 rounded-full"
            :style="{ backgroundColor: selected.has(chip.name) ? chip.color : 'hsl(var(--bar))' }"
            aria-hidden="true"
          ></span>
          <span class="truncate">{{ chip.label }}</span>
        </button>

        <div v-if="!chips.length" class="w-full py-4 text-center text-sm text-muted-foreground">
          此节点未配置通信探测
        </div>
      </div>

      <HistoryChart
        v-if="probes.length"
        id="latency-plot"
        empty-id="latency-empty"
        :empty-text="emptyText(probes, latencySeries, '延迟')"
        :series="latencySeries"
        :bands="lossSeries"
        kind="latency"
        :hours="hours"
        :theme="theme"
      />
    </CardContent>
  </Card>
</template>
