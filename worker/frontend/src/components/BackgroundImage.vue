<script setup lang="ts">
import { ref, watch } from "vue";
import { DEFAULT_BACKGROUND } from "../runtime";
const props = defineProps<{ background: string }>();
const emit = defineEmits<{ unreadable: [background: string] }>();
const failed = ref(false);
watch(
  () => props.background,
  () => {
    failed.value = false;
  },
);
function onError() {
  if (failed.value || !props.background) return;
  failed.value = true;
  emit("unreadable", props.background);
}
</script>
<template>
  <img
    :src="!failed && background ? background : DEFAULT_BACKGROUND"
    alt=""
    decoding="async"
    @error="onError"
  />
</template>
