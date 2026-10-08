<script setup lang="ts">
import { computed } from "vue";
import { clamp } from "../domain/format";
import { Progress } from "./ui/progress";

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

const status = computed(() => {
  if (value.value >= props.critical) return "critical";
  if (value.value >= props.warning) return "warning";
  return "healthy";
});
</script>

<template>
  <div
    class="flex min-w-[70px] flex-1 flex-col gap-2"
    role="progressbar"
    :aria-label="`${label} ${value.toFixed(1)}%`"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="value.toFixed(1)"
  >
    <div class="flex items-center justify-between text-sm">
      <span class="text-muted-foreground">{{ shortLabel }}</span>
      <span class="font-medium tabular-nums">{{ value.toFixed(0) }}%</span>
    </div>
    <Progress :model-value="value" :status="status" class="h-1.5" />
  </div>
</template>
