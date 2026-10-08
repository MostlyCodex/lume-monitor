<script setup lang="ts">
defineProps<{ name: "refresh" | "theme" | "search" }>();
</script>
<template>
  <svg v-if="name === 'refresh'" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
  </svg>
  <svg v-else-if="name === 'theme'" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5a8.5 8.5 0 0 0 0 17z" />
  </svg>
  <svg v-else-if="name === 'search'" viewBox="0 0 24 24" aria-hidden="true" fill="none">
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </svg>
</template>

<style scoped>
/* :where() 保持零特异性，调用方的 h-4 w-4 等 Tailwind 类可以覆盖尺寸 */
:where(svg) {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}
</style>
