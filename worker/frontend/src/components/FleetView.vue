<script setup lang="ts">
import { computed, ref } from "vue";
import type { HistorySnapshot, NodeSnapshot } from "../types";
import type { Overview } from "../domain/overview";
import AppIcon from "./AppIcon.vue";
import NodeCard from "./NodeCard.vue";
const props = defineProps<{
  nodes: NodeSnapshot[];
  history: HistorySnapshot | null;
  health: Overview;
  now: number;
}>();
const emit = defineEmits<{ open: [id: string] }>();
const search = ref("");
const filtered = computed(() => {
  const query = search.value.trim().toLocaleLowerCase("zh-CN");
  return props.nodes.filter(
    (node) =>
      !query ||
      [node.label, node.role, node.region, node.country].some((value) =>
        value?.toLocaleLowerCase("zh-CN").includes(query),
      ),
  );
});
</script>
<template>
  <section id="fleet-view" class="fleet-view">
    <header class="fleet-heading is-summary-only">
      <div id="summary-strip" class="summary-strip" aria-label="总体状态">
        <div
          v-for="item in health.summary"
          :key="item.label"
          class="summary-item"
          :class="item.tone ? `is-${item.tone}` : ''"
        >
          <span>{{ item.label }}</span
          ><strong>{{ item.value }}</strong>
        </div>
      </div>
    </header>
    <div class="fleet-toolbar">
      <label class="search-control"
        ><AppIcon name="search" /><span class="sr-only">筛选节点</span
        ><input
          id="node-search"
          v-model="search"
          type="search"
          placeholder="搜索节点"
          autocomplete="off"
      /></label>
    </div>
    <div id="node-grid" class="node-grid" aria-live="polite">
      <NodeCard
        v-for="node in filtered"
        :key="node.id"
        :node="node"
        :history="history"
        :now="now"
        @open="emit('open', $event)"
      />
      <div v-if="!filtered.length" class="empty-state">
        <i>◇</i><strong>没有符合条件的节点</strong><span>请调整搜索内容后重试</span>
      </div>
    </div>
  </section>
</template>
