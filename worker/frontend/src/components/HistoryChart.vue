<script setup lang="ts">
import { computed } from "vue";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent, MarkLineComponent } from "echarts/components";
import VChart from "vue-echarts";
import "vue-echarts/style.css";
import type { ChartSeries, NetworkLayer, Theme } from "../types";
import { finite } from "../charts/series";
import { chartOptions } from "../charts/options";
import HistoryTooltip from "./HistoryTooltip.vue";

// This component is lazy-loaded; register only the modules used by history charts.
use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, MarkLineComponent]);
const props = defineProps<{
  id: string;
  emptyId: string;
  series: ChartSeries[];
  kind: "network" | "rate";
  hours: number;
  theme: Theme;
  layers: readonly NetworkLayer[];
}>();
const usable = computed(() =>
  props.series.filter(
    (series) =>
      series.points.some((point) => finite(point.y)) ||
      (props.kind === "network" && series.lossPoints?.some((point) => finite(point.y))),
  ),
);
const option = computed(() => {
  void props.theme;
  return chartOptions(usable.value, props);
});
</script>
<template>
  <div
    :id="id"
    class="plot-host"
    :class="{ 'plot-host-network': kind === 'network' }"
    role="img"
    :aria-label="kind === 'network' ? '网络延迟与丢包历史图' : '网络速率历史图'"
  >
    <VChart
      v-if="usable.length"
      class="history-chart"
      :option="option"
      :autoresize="{ throttle: 100 }"
    >
      <template #tooltip="params">
        <HistoryTooltip :params="params" :series="usable" :kind="kind" />
      </template>
    </VChart>
  </div>
  <div :id="emptyId" class="chart-empty" :class="{ 'is-hidden': usable.length }">
    {{ kind === "network" ? "暂无网络质量历史" : "暂无速率历史" }}
  </div>
</template>
<style scoped>
.history-chart {
  width: 100%;
  height: 100%;
}
</style>
