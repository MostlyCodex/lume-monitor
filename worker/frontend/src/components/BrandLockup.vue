<script setup lang="ts">
import markUrl from "../assets/lume-mark.svg?no-inline";

defineProps<{ brand: string; tagline?: string }>();
</script>

<template>
  <div class="brand-lockup">
    <img class="lume-mark" :src="markUrl" width="28" height="28" alt="" aria-hidden="true" />
    <!-- The mark alone identifies the panel; the name stays available to assistive technology. -->
    <strong data-dashboard-brand class="sr-only">{{ brand }}</strong>
    <small v-if="tagline" class="brand-tagline">{{ tagline }}</small>
  </div>
</template>

<style scoped>
.brand-lockup {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.lume-mark {
  display: block;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
}
.brand-tagline {
  color: hsl(var(--muted-foreground));
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
