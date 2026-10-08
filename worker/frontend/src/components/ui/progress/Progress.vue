<script setup lang="ts">
import { computed, type HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";

const props = withDefaults(
  defineProps<{
    modelValue?: number;
    max?: number;
    class?: HTMLAttributes["class"];
    indicatorClass?: HTMLAttributes["class"];
    status?: "healthy" | "warning" | "critical" | "default";
  }>(),
  { modelValue: 0, max: 100, status: "default" },
);

const percentage = computed(() => {
  const val = props.modelValue ?? 0;
  return Math.min(Math.max((val / props.max) * 100, 0), 100);
});

const statusClasses = {
  default: "bg-primary",
  healthy: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-rose-500",
};
</script>
<template>
  <div
    role="progressbar"
    :aria-valuenow="modelValue"
    :aria-valuemax="max"
    :class="cn('relative h-1.5 w-full overflow-hidden rounded-full bg-secondary', props.class)"
  >
    <div
      :class="
        cn(
          'h-full w-full flex-1 transition-all duration-500 ease-out',
          statusClasses[status],
          indicatorClass,
        )
      "
      :style="{ transform: 'translateX(-' + (100 - percentage) + '%)' }"
    />
  </div>
</template>
