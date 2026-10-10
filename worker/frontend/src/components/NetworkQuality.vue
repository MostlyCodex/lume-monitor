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
import { Button } from "./ui/button";

const HistoryChart = defineAsyncComponent(() => import("./HistoryChart.vue"));

const props = defineProps<{
  node: NodeSnapshot;
  history: HistorySnapshot | null;
  hours: number;
  theme: Theme;
}>();

const selected = ref(new Set<string>());
const probes = computed(() => allProbes(props.node));
// 只有 ICMP 探测有丢包率；没有 ICMP 探测的节点不显示丢包率卡片
const icmpProbes = computed(() => probes.value.filter((probe) => probe.kind === "icmp"));

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
const lossSeries = computed(() => seriesFor(icmpProbes.value, "packet_loss_percent"));

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
    <CardHeader class="grid-cols-[1fr_auto] items-center">
      <CardTitle>延迟</CardTitle>
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
      <!-- 线路选择：颜色标识与名称，同时作用于延迟和丢包率两张图；无边框、无悬停样式，状态只由底色区分 -->
      <div id="detail-probe-summary" class="flex flex-wrap gap-1.5">
        <button
          v-for="chip in chips"
          :key="chip.name"
          type="button"
          class="detail-probe-card inline-flex h-7 max-w-full select-none items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-[color,box-shadow,opacity] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-8 sm:px-2.5 sm:text-sm"
          :class="[selected.has(chip.name) ? 'bg-accent text-accent-foreground' : 'opacity-50']"
          :data-detail-probe="chip.name"
          :aria-pressed="selected.has(chip.name)"
          @click="toggleProbe(chip.name)"
        >
          <span
            class="detail-probe-swatch h-2 w-2 shrink-0 rounded-full"
            :style="{ backgroundColor: chip.color }"
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
        kind="latency"
        :hours="hours"
        :theme="theme"
      />
    </CardContent>
  </Card>

  <Card v-if="icmpProbes.length" id="detail-loss">
    <CardHeader>
      <CardTitle>丢包率</CardTitle>
    </CardHeader>
    <CardContent>
      <HistoryChart
        id="loss-plot"
        empty-id="loss-empty"
        :empty-text="emptyText(icmpProbes, lossSeries, '丢包率')"
        :series="lossSeries"
        kind="loss"
        :hours="hours"
        :theme="theme"
      />
    </CardContent>
  </Card>
</template>
