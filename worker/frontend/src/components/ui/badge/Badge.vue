<script setup lang="ts">
import { computed, type HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";

export type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "healthy"
  | "degraded"
  | "critical"
  | "stale";

const props = withDefaults(
  defineProps<{ variant?: BadgeVariant; class?: HTMLAttributes["class"] }>(),
  { variant: "default" },
);

// 对应 shadcn v4 badge.tsx；状态类变体统一为描边胶囊 + 状态色圆点
const badgeVariants = {
  default: "bg-primary text-primary-foreground",
  secondary: "bg-secondary text-secondary-foreground",
  destructive: "bg-destructive text-white",
  outline: "border-border text-foreground",
  healthy: "border-border text-foreground",
  degraded: "border-border text-foreground",
  critical: "border-border text-foreground",
  stale: "border-border text-muted-foreground",
};
const dots: Partial<Record<BadgeVariant, string>> = {
  healthy: "bg-status-ok",
  degraded: "bg-status-warn",
  critical: "bg-status-bad",
  stale: "bg-muted-foreground",
};

const classes = computed(() =>
  cn(
    "inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full border border-transparent px-2 py-0.5 text-xs font-medium",
    badgeVariants[props.variant],
    props.class,
  ),
);
</script>
<template>
  <span :class="classes">
    <span
      v-if="dots[variant]"
      class="size-1.5 shrink-0 rounded-full"
      :class="dots[variant]"
      aria-hidden="true"
    ></span>
    <slot />
  </span>
</template>
