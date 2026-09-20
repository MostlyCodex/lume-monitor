<script setup lang="ts">
import { computed } from "vue";
import type { TooltipComponentFormatterCallbackParams } from "echarts";
import type { ChartSeries } from "../types";
import { finite } from "../charts/series";
import { formatLoss, formatRate, formatTime } from "../domain/format";
const props = defineProps<{
  params: TooltipComponentFormatterCallbackParams;
  series: ChartSeries[];
  kind: "network" | "rate";
}>();
const samples = computed(() =>
  ("componentType" in props.params ? [props.params] : Object.values(props.params)).filter((item) =>
    Array.isArray(item.value),
  ),
);
const time = computed(() => Number((samples.value[0]?.value as number[] | undefined)?.[0]) / 1000);
const rows = computed(() =>
  props.series.map((item) => {
    const sample = samples.value.find((sample) => sample.seriesId === item.id);
    const [, value, loss] = Array.isArray(sample?.value) ? sample.value : [];
    return {
      id: item.id,
      label: item.label,
      color: item.color,
      value: finite(value)
        ? props.kind === "network"
          ? `${Math.round(value)} ms`
          : formatRate(value)
        : "—",
      loss: finite(loss) ? formatLoss(loss) : "—",
      failureLabel: item.failureLabel || "丢包",
    };
  }),
);
</script>
<template>
  <div class="plot-tooltip" :class="{ 'plot-tooltip-metric': kind === 'rate' }" role="status">
    <time>{{ formatTime(time, true) }}</time>
    <div class="plot-tooltip-list">
      <div
        v-for="row in rows"
        :key="row.id"
        class="plot-tooltip-row"
        :class="{ 'is-single': kind === 'rate' }"
      >
        <span class="plot-tooltip-target"
          ><i :style="{ '--tooltip-color': row.color }"></i><b>{{ row.label }}</b></span
        >
        <span
          ><em v-if="kind === 'network'">延迟</em><b>{{ row.value }}</b></span
        >
        <span v-if="kind === 'network'"
          ><em>{{ row.failureLabel }}</em
          ><b>{{ row.loss }}</b></span
        >
      </div>
    </div>
  </div>
</template>
