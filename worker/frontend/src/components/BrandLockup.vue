<script setup lang="ts">
import markUrl from "../assets/lume-mark.svg?no-inline";

defineProps<{ brand: string; tagline: string }>();
</script>

<template>
  <div class="brand-lockup">
    <img class="lume-mark" :src="markUrl" width="36" height="36" alt="" aria-hidden="true" />
    <div>
      <strong data-dashboard-brand>
        <!-- Outlined lettering keeps the chosen wordmark consistent without loading a font.
             Custom panel names remain ordinary text, including their accessible name. -->
        <template v-if="brand === 'Lume'">
          <svg class="lume-wordmark" viewBox="0 0 135 36" aria-hidden="true" focusable="false">
            <path
              d="M2 1h6a2 2 0 0 1 2 2v21a2 2 0 0 0 2 2h11a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H9a9 9 0 0 1-9-9V3a2 2 0 0 1 2-2Z"
            />
            <path
              d="M30 9h4a2 2 0 0 1 2 2v12q0 5 5 5t5-5V11a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v21a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-1q-3 4-9 4-9 0-9-11V11a2 2 0 0 1 2-2Z"
            />
            <path
              d="M60 9h4a2 2 0 0 1 2 2v1q3-4 8-4 6 0 8 5 4-5 10-5 9 0 9 11v13a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V21q0-5-4-5t-4 5v11a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V21q0-5-5-5t-5 5v11a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2Z"
            />
            <path
              fill-rule="evenodd"
              d="M120 8c-9 0-15 6-15 14s6 13 15 13c6 0 11-2 14-6l-5-5c-2 3-5 4-8 4-4 0-7-2-8-5h19a2 2 0 0 0 2-2v-1c0-7-5-12-14-12Zm-7 10c1-3 3-4 7-4 3 0 5 1 6 4Z"
            />
          </svg>
          <span class="sr-only">{{ brand }}</span>
        </template>
        <template v-else>{{ brand }}</template>
      </strong>
      <small class="brand-tagline">{{ tagline }}</small>
    </div>
  </div>
</template>
