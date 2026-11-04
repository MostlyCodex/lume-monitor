<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Sortable from "sortablejs";
import type { HistorySnapshot, NodeSnapshot } from "../types";
import NodeCard from "./NodeCard.vue";

const props = defineProps<{
  nodes: NodeSnapshot[];
  history: HistorySnapshot | null;
  now: number;
  search: string;
}>();

const emit = defineEmits<{ open: [id: string]; reorder: [order: string[]] }>();
const grid = ref<HTMLElement | null>(null);
let sortable: Sortable | undefined;
let restoreBefore: Node | null = null;

const filtered = computed(() => {
  const query = props.search.trim().toLocaleLowerCase("zh-CN");
  return props.nodes.filter(
    (node) =>
      !query ||
      [node.label, node.region, node.country].some((value) =>
        value?.toLocaleLowerCase("zh-CN").includes(query),
      ),
  );
});

// SortableJS moves DOM nodes itself; put the card back and let Vue re-render from the new order.
onMounted(() => {
  if (!grid.value) return;
  sortable = Sortable.create(grid.value, {
    draggable: "[data-node]",
    animation: 180,
    // 触屏需按住片刻再拖动，避免和页面滚动冲突
    delay: 220,
    delayOnTouchOnly: true,
    touchStartThreshold: 4,
    // 统一用指针事件实现拖拽：原生 HTML5 拖拽在手机浏览器上不可靠
    forceFallback: true,
    fallbackTolerance: 4,
    // 拖动中的副本挂到 body 上，才能浮在所有卡片之上并应用下面的样式
    fallbackOnBody: true,
    ghostClass: "node-card-ghost",
    chosenClass: "node-card-chosen",
    dragClass: "node-card-drag",
    onStart: (event) => {
      restoreBefore = event.item.nextSibling;
    },
    onEnd: (event) => {
      const { item, from, oldDraggableIndex, newDraggableIndex } = event;
      from.insertBefore(item, restoreBefore);
      restoreBefore = null;
      if (oldDraggableIndex === undefined || newDraggableIndex === undefined) return;
      if (oldDraggableIndex === newDraggableIndex) return;
      const order = props.nodes.map((node) => node.id);
      const [moved] = order.splice(oldDraggableIndex, 1);
      order.splice(newDraggableIndex, 0, moved);
      emit("reorder", order);
    },
  });
});
// 搜索时只显示部分节点，此时禁用拖拽以免顺序含义不清
watch(
  () => props.search,
  (value) => sortable?.option("disabled", Boolean(value.trim())),
);
onBeforeUnmount(() => sortable?.destroy());
</script>

<template>
  <section id="fleet-view">
    <!-- 节点网格卡片 -->
    <div
      id="node-grid"
      ref="grid"
      class="grid grid-cols-1 items-start gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3"
      aria-live="polite"
    >
      <NodeCard
        v-for="node in filtered"
        :key="node.id"
        :node="node"
        :history="history"
        :now="now"
        @open="emit('open', $event)"
      />
    </div>

    <!-- 搜索为空状态 -->
    <div
      v-if="!filtered.length"
      class="glass flex flex-col items-center justify-center rounded-2xl p-12 text-center"
    >
      <strong class="text-sm font-medium">没有符合条件的节点</strong>
      <span class="mt-1 text-sm text-muted-foreground">请尝试调整搜索关键词</span>
    </div>
  </section>
</template>

<style scoped>
/* 原位置留下虚线占位，提示松手后卡片会落在这里 */
#node-grid :deep(.node-card-ghost) {
  background: transparent;
  box-shadow: inset 0 0 0 2px hsl(var(--border));
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
#node-grid :deep(.node-card-ghost > *) {
  visibility: hidden;
}
/* 跟随指针的副本：无过渡、略微抬起，看得出被拿起来了 */
:global(.node-card-drag) {
  cursor: grabbing !important;
  opacity: 1 !important;
  transition: none !important;
  scale: 1.02;
  rotate: 1deg;
  box-shadow:
    0 20px 40px -12px rgb(0 0 0 / 0.45),
    0 0 0 1px hsl(var(--border));
}
:global(body:has(.node-card-drag)) {
  cursor: grabbing;
  user-select: none;
}
</style>
