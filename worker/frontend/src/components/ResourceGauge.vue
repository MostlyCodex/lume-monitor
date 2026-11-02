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

// 数值保持正文色，只有细条在占用偏高时着色
const barClass = computed(() => {
  if (value.value >= props.critical) return "bg-status-bad";
  if (value.value >= props.warning) return "bg-status-warn";
  return "bg-muted-foreground/45";
});
</script>

<template>
  <div
    class="flex min-w-0 flex-col gap-1.5"
    role="progressbar"
    :aria-label="`${label} ${value.toFixed(1)}%`"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="value.toFixed(1)"
  >
    <div class="flex items-baseline justify-between gap-2 text-[12.5px] leading-none">
      <span class="text-muted-foreground">{{ shortLabel }}</span>
      <span class="font-medium">{{ value.toFixed(0) }}%</span>
    </div>
    <div class="h-0.5 overflow-hidden rounded-full bg-track">
      <div class="h-full rounded-full" :class="barClass" :style="{ width: `${value}%` }"></div>
    </div>
  </div>
</template>
