<script setup lang="ts">
import { computed, type ButtonHTMLAttributes, type HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";

export type ButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
export type ButtonSize = "default" | "sm" | "lg" | "icon";

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant;
    size?: ButtonSize;
    class?: HTMLAttributes["class"];
    type?: ButtonHTMLAttributes["type"];
    disabled?: boolean;
  }>(),
  { variant: "default", size: "default", type: "button", disabled: false },
);

const buttonVariants = {
  default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
  destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
  outline:
    "border border-border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
  secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
  ghost: "hover:bg-accent hover:text-accent-foreground",
  link: "text-primary underline-offset-4 hover:underline",
};

const buttonSizes = {
  default: "h-9 px-4 py-2 text-sm",
  sm: "h-8 rounded-md px-3 text-xs",
  lg: "h-10 rounded-md px-8 text-base",
  icon: "h-9 w-9 p-0",
};

const classes = computed(() =>
  cn(
    "inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 select-none",
    buttonVariants[props.variant],
    buttonSizes[props.size],
    props.class,
  ),
);
</script>
<template>
  <button :type="type" :disabled="disabled" :class="classes">
    <slot />
  </button>
</template>
