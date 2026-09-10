<script setup lang="ts">
import { computed } from "vue";
import { clamp } from "../domain/format";
const props = withDefaults(
  defineProps<{
    label: string;
    shortLabel: string;
    value?: number | null;
    warning?: number;
    critical?: number;
  }>(),
  { warning: 70, critical: 85 },
);
const value = computed(() => clamp(props.value, 0, 100));
const severity = computed(() =>
  value.value >= props.critical ? "critical" : value.value >= props.warning ? "warning" : "healthy",
);
</script>
<template>
  <div
    class="resource-gauge"
    :class="`is-${severity}`"
    role="progressbar"
    :aria-label="`${label} ${value.toFixed(1)}%`"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="value.toFixed(1)"
  >
    <div class="resource-gauge-head">
      <strong>{{ shortLabel }}</strong
      ><span>{{ value.toFixed(0) }}%</span>
    </div>
    <svg class="resource-gauge-track" aria-hidden="true" focusable="false">
      <line class="resource-gauge-base" x1="0" y1="6.5" x2="100%" y2="6.5" pathLength="100" />
      <line
        v-if="value > 0.05"
        class="resource-gauge-fill"
        x1="0"
        y1="6.5"
        x2="100%"
        y2="6.5"
        pathLength="100"
        :stroke-dasharray="`${value.toFixed(1)} ${(100.1 - value).toFixed(1)}`"
      />
      <line
        class="resource-threshold resource-threshold-warning"
        :x1="`${warning}%`"
        y1="1"
        :x2="`${warning}%`"
        y2="12"
      />
      <line
        class="resource-threshold resource-threshold-critical"
        :x1="`${critical}%`"
        y1="1"
        :x2="`${critical}%`"
        y2="12"
      />
      <circle
        v-if="value > 0.05"
        class="resource-gauge-marker"
        :cx="`${value.toFixed(1)}%`"
        cy="6.5"
        r="4.5"
      />
    </svg>
  </div>
</template>
