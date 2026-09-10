<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ country?: string }>();
const code = computed(() => props.country?.trim().toUpperCase() ?? "");
</script>
<template>
  <svg v-if="code === 'US'" viewBox="0 0 36 24" aria-hidden="true" focusable="false">
    <rect width="36" height="24" fill="#fff" />
    <path
      fill="#b22234"
      d="M0 0h36v1.85H0zm0 3.69h36v1.85H0zm0 3.69h36v1.85H0zm0 3.69h36v1.85H0zm0 3.7h36v1.84H0zm0 3.69h36v1.85H0zm0 3.69h36V24H0z"
    />
    <path fill="#3c3b6e" d="M0 0h15.5v12.92H0z" />
    <g fill="#fff">
      <circle cx="2" cy="2" r=".55" />
      <circle cx="5" cy="2" r=".55" />
      <circle cx="8" cy="2" r=".55" />
      <circle cx="11" cy="2" r=".55" />
      <circle cx="14" cy="2" r=".55" />
      <circle cx="3.5" cy="4.2" r=".55" />
      <circle cx="6.5" cy="4.2" r=".55" />
      <circle cx="9.5" cy="4.2" r=".55" />
      <circle cx="12.5" cy="4.2" r=".55" />
      <circle cx="2" cy="6.4" r=".55" />
      <circle cx="5" cy="6.4" r=".55" />
      <circle cx="8" cy="6.4" r=".55" />
      <circle cx="11" cy="6.4" r=".55" />
      <circle cx="14" cy="6.4" r=".55" />
      <circle cx="3.5" cy="8.6" r=".55" />
      <circle cx="6.5" cy="8.6" r=".55" />
      <circle cx="9.5" cy="8.6" r=".55" />
      <circle cx="12.5" cy="8.6" r=".55" />
      <circle cx="2" cy="10.8" r=".55" />
      <circle cx="5" cy="10.8" r=".55" />
      <circle cx="8" cy="10.8" r=".55" />
      <circle cx="11" cy="10.8" r=".55" />
      <circle cx="14" cy="10.8" r=".55" />
    </g>
  </svg>
  <svg v-else-if="code === 'JP'" viewBox="0 0 36 24" aria-hidden="true" focusable="false">
    <rect width="36" height="24" fill="#fff" />
    <circle cx="18" cy="12" r="7.2" fill="#bc002d" />
  </svg>
  <svg v-else-if="code === 'SG'" viewBox="0 0 36 24" aria-hidden="true" focusable="false">
    <rect width="36" height="24" fill="#fff" />
    <rect width="36" height="12" fill="#ef3340" />
    <path
      fill="#fff"
      fill-rule="evenodd"
      d="M9.5 2.05a4.95 4.95 0 1 0 0 7.9 4.15 4.15 0 1 1 0-7.9Z"
    />
    <g fill="#fff">
      <circle cx="11.6" cy="3" r=".65" />
      <circle cx="13.6" cy="4.4" r=".65" />
      <circle cx="12.85" cy="6.75" r=".65" />
      <circle cx="10.35" cy="6.75" r=".65" />
      <circle cx="9.6" cy="4.4" r=".65" />
    </g>
  </svg>
  <span v-else class="flag-fallback" aria-hidden="true">{{
    /^[A-Z]{2}$/.test(code) ? code : "◇"
  }}</span>
</template>
