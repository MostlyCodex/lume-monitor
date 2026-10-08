<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Sortable from "sortablejs";
import type { HistorySnapshot, NodeSnapshot } from "../types";
import AppIcon from "./AppIcon.vue";
import NodeCard from "./NodeCard.vue";

const props = defineProps<{
  nodes: NodeSnapshot[];
  history: HistorySnapshot | null;
  now: number;
}>();

const emit = defineEmits<{ open: [id: string]; reorder: [order: string[]] }>();
const search = ref("");
const grid = ref<HTMLElement | null>(null);
let sortable: Sortable | undefined;
let restoreBefore: Node | null = null;

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
watch(search, (value) => sortable?.option("disabled", Boolean(value.trim())));
onBeforeUnmount(() => sortable?.destroy());
</script>

<template>
  <section id="fleet-view" class="space-y-6">
    <!-- 搜索 -->
    <div class="flex justify-end">
      <div class="relative w-full sm:w-64">
        <AppIcon
          name="search"
          class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
        />
        <input
          id="node-search"
          v-model="search"
          type="search"
          placeholder="搜索节点..."
          aria-label="搜索节点名称、角色、地区"
          autocomplete="off"
          class="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 pl-9 text-sm shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-white/[0.045]"
        />
      </div>
    </div>

    <!-- 节点网格卡片 -->
    <div
      id="node-grid"
      ref="grid"
      class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5"
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
      class="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center"
    >
      <strong class="text-sm font-medium">没有符合条件的节点</strong>
      <span class="mt-1 text-sm text-muted-foreground">请尝试调整搜索关键词</span>
    </div>
  </section>
</template>

<style scoped>
/* 原位置留下虚线占位，提示松手后卡片会落在这里 */
#node-grid :deep(.node-card-ghost) {
  border: 2px dashed hsl(var(--border));
  background: hsl(var(--muted) / 0.4);
  box-shadow: none;
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
