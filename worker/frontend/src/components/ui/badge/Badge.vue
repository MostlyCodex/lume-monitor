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

const badgeVariants = {
  default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
  secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
  destructive:
    "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
  outline: "text-foreground border border-border",
  healthy:
    "border-emerald-500/25 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 font-medium shadow-none",
  degraded:
    "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium shadow-none",
  critical:
    "border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-400 font-medium shadow-none",
  stale:
    "border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 font-medium shadow-none",
};

const classes = computed(() =>
  cn(
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
    badgeVariants[props.variant],
    props.class,
  ),
);
</script>
<template>
  <div :class="classes">
    <slot />
  </div>
</template>
