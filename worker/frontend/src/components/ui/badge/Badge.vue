<script setup lang="ts">
import { computed, type HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";

export type BadgeVariant = "outline" | "healthy" | "warning" | "critical" | "offline";

const props = defineProps<{ variant: BadgeVariant; class?: HTMLAttributes["class"] }>();

// 对应 shadcn v4 badge.tsx 的描边样式；状态类变体额外带状态色圆点
const dots: Partial<Record<BadgeVariant, string>> = {
  healthy: "bg-status-ok",
  warning: "bg-status-warn",
  critical: "bg-status-bad",
  offline: "bg-muted-foreground/50",
};

const classes = computed(() =>
  cn(
    "inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-xs font-medium text-foreground",
    props.variant === "offline" && "text-muted-foreground",
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
