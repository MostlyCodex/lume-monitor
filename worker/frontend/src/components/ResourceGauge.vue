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
    class="flex flex-col gap-1.5 min-w-[70px] flex-1"
    role="progressbar"
    :aria-label="`${label} ${value.toFixed(1)}%`"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="value.toFixed(1)"
  >
    <div class="flex items-center justify-between text-xs">
      <span class="text-muted-foreground font-medium text-[11px] tracking-wider uppercase">{{
        shortLabel
      }}</span>
      <span class="font-mono text-xs font-semibold tabular-nums text-foreground">
        {{ value.toFixed(0) }}%
      </span>
    </div>
    <Progress :model-value="value" :status="status" class="h-1.5" />
  </div>
</template>
