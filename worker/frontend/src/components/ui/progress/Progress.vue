<script setup lang="ts">
import { computed, type HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";

const props = withDefaults(
  defineProps<{
    modelValue?: number;
    max?: number;
    class?: HTMLAttributes["class"];
    status?: "healthy" | "warning" | "critical" | "default";
  }>(),
  { modelValue: 0, max: 100, status: "default" },
);

const percentage = computed(() => {
  const val = props.modelValue ?? 0;
  return Math.min(Math.max((val / props.max) * 100, 0), 100);
});

// 对应 shadcn v4 progress.tsx；按状态使用状态色
const statusClasses = {
  default: "bg-primary",
  healthy: "bg-status-ok",
  warning: "bg-status-warn",
  critical: "bg-status-bad",
};
</script>
<template>
  <div
    role="progressbar"
    :aria-valuenow="modelValue"
    :aria-valuemax="max"
    :class="cn('relative h-2 w-full overflow-hidden rounded-full bg-primary/20', props.class)"
  >
    <div
      :class="cn('h-full w-full flex-1 transition-all', statusClasses[status])"
      :style="{ transform: 'translateX(-' + (100 - percentage) + '%)' }"
    />
  </div>
</template>
