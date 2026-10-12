<script setup lang="ts">
import { computed, type ButtonHTMLAttributes, type HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";

export type ButtonVariant = "default" | "outline" | "ghost";
export type ButtonSize = "default" | "sm" | "icon-sm";

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

// 对应 shadcn v4 button.tsx；深色描边按钮的 bg-input/30 因 --input 自带透明度改写为固定值
const buttonVariants = {
  default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
  outline:
    "border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-white/[0.045] dark:hover:bg-white/[0.075]",
  ghost: "hover:bg-accent hover:text-accent-foreground",
};

const buttonSizes = {
  default: "h-9 px-4 py-2",
  sm: "h-8 gap-1.5 px-3",
  "icon-sm": "size-8",
};

const classes = computed(() =>
  cn(
    "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
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
