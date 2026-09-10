<script setup lang="ts">
import { ref, watch } from "vue";
import type { DashboardLayout, NodeSnapshot } from "../types";
import { useSettingsDraft } from "../composables/useSettingsDraft";
import BackgroundImage from "./BackgroundImage.vue";
const props = defineProps<{
  open: boolean;
  layout: DashboardLayout;
  nodes: NodeSnapshot[];
  persist: (layout: DashboardLayout) => boolean;
  resetPreferences: () => boolean;
}>();
const emit = defineEmits<{
  close: [];
  preview: [background: string | null];
  notify: [message: string];
}>();
const dialog = ref<HTMLDialogElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const {
  draft,
  processing,
  error,
  imageError,
  status,
  start,
  cancel,
  choose,
  resetBackground,
  move,
  save,
  reset,
} = useSettingsDraft({
  layout: () => props.layout,
  nodes: () => props.nodes,
  persist: (value) => props.persist(value),
  reset: () => props.resetPreferences(),
  close: () => emit("close"),
  preview: (value) => emit("preview", value),
  notify: (value) => emit("notify", value),
});
watch(
  () => props.open,
  (open) => {
    if (open) {
      start();
      dialog.value?.showModal();
    } else if (dialog.value?.open) dialog.value.close();
  },
  { flush: "post" },
);
function chooseFile(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  input.value = "";
  if (file) void choose(file);
}
function countryChanged(id: string, event: Event) {
  const input = event.target as HTMLInputElement;
  input.value = input.value.toUpperCase().replace(/[^A-Z]/g, "");
  draft.nodes[id].country = input.value;
}
</script>
<template>
  <dialog
    ref="dialog"
    @cancel.prevent="cancel"
    @click.self="cancel"
    id="settings-dialog"
    class="settings-dialog"
    aria-labelledby="settings-title"
  >
    <form id="settings-form" @submit.prevent="save" class="settings-shell">
      <header class="settings-head">
        <div>
          <p class="eyebrow">LOCAL DISPLAY</p>
          <h2 id="settings-title">面板显示设置</h2>
          <p>设置仅保存在当前浏览器，不修改服务器资料或监测数据。</p>
        </div>
        <button
          id="settings-close"
          @click="cancel"
          class="icon-button"
          type="button"
          aria-label="关闭设置"
        >
          ×
        </button>
      </header>

      <section class="settings-section">
        <div class="settings-section-title"><strong>页面信息</strong><span>面板名称</span></div>
        <div class="settings-global-grid">
          <label class="settings-wide"
            ><span>面板名称</span
            ><input
              id="settings-brand"
              v-model="draft.brand"
              type="text"
              maxlength="48"
              autocomplete="off"
          /></label>
        </div>
      </section>

      <section class="settings-section" aria-labelledby="settings-background-title">
        <div class="settings-section-title">
          <strong id="settings-background-title">背景图片</strong><span>自动铺满 · 居中裁切</span>
        </div>
        <div class="settings-background-layout">
          <div class="settings-background-controls">
            <input
              id="settings-background-file"
              ref="fileInput"
              @change="chooseFile"
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              hidden
            />
            <div class="settings-background-buttons">
              <button
                id="settings-background-choose"
                @click="fileInput?.click()"
                class="button button-ghost"
                type="button"
                aria-describedby="settings-background-help"
              >
                选择图片
              </button>
              <button
                id="settings-background-reset"
                :disabled="!draft.background && !processing"
                @click="resetBackground"
                class="button button-ghost"
                type="button"
              >
                恢复默认背景
              </button>
            </div>
            <p id="settings-background-help">
              JPG / PNG / WebP，最大 10 MB、2400 万像素。自动压缩，仅保存在当前浏览器。
            </p>
            <p id="settings-background-status" role="status" aria-live="polite">{{ status }}</p>
            <p
              id="settings-background-error"
              class="settings-error"
              role="alert"
              :hidden="!imageError"
            >
              {{ imageError }}
            </p>
          </div>
          <div class="background-previews" role="group" aria-label="背景裁切预览">
            <figure>
              <div class="background-preview background-preview-wide">
                <BackgroundImage :background="draft.background" />
              </div>
              <figcaption>横屏预览</figcaption>
            </figure>
            <figure>
              <div class="background-preview background-preview-tall">
                <BackgroundImage :background="draft.background" />
              </div>
              <figcaption>竖屏预览</figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section-title">
          <strong>节点卡片</strong><span>用箭头调整首页顺序</span>
        </div>
        <div id="settings-node-list" class="settings-node-list">
          <article
            v-for="(id, index) in draft.order"
            :key="id"
            class="settings-node"
            :data-settings-node="id"
          >
            <header>
              <div>
                <span>{{ String(index + 1).padStart(2, "0") }}</span
                ><strong>{{ draft.nodes[id].label || id }}</strong
                ><small>{{ id }}</small>
              </div>
              <div class="settings-order-actions">
                <button
                  class="icon-button"
                  type="button"
                  data-settings-move="-1"
                  :aria-label="`上移 ${draft.nodes[id].label || id}`"
                  :disabled="index === 0"
                  @click="move(id, -1)"
                >
                  ↑
                </button>
                <button
                  class="icon-button"
                  type="button"
                  data-settings-move="1"
                  :aria-label="`下移 ${draft.nodes[id].label || id}`"
                  :disabled="index === draft.order.length - 1"
                  @click="move(id, 1)"
                >
                  ↓
                </button>
              </div>
            </header>
            <div class="settings-node-grid">
              <label
                ><span>显示名称</span
                ><input
                  v-model="draft.nodes[id].label"
                  type="text"
                  data-settings-field="label"
                  maxlength="64"
                  autocomplete="off"
              /></label>
              <label
                ><span>角色标题</span
                ><input
                  v-model="draft.nodes[id].role"
                  type="text"
                  data-settings-field="role"
                  maxlength="80"
                  autocomplete="off"
              /></label>
              <label
                ><span>国家代码</span
                ><input
                  :value="draft.nodes[id].country"
                  class="settings-country"
                  type="text"
                  data-settings-field="country"
                  maxlength="2"
                  placeholder="US"
                  autocomplete="off"
                  @input="countryChanged(id, $event)"
              /></label>
              <label
                ><span>城市 / 区域</span
                ><input
                  v-model="draft.nodes[id].region"
                  type="text"
                  data-settings-field="region"
                  maxlength="80"
                  autocomplete="off"
              /></label>
            </div>
          </article>
        </div>
      </section>

      <footer class="settings-actions">
        <p id="settings-error" class="settings-error" role="alert" :hidden="!error">{{ error }}</p>
        <button id="settings-reset" @click="reset" class="button button-ghost" type="button">
          全部恢复默认
        </button>
        <span></span>
        <button id="settings-cancel" @click="cancel" class="button button-ghost" type="button">
          取消
        </button>
        <button
          id="settings-save"
          :disabled="processing"
          class="button button-primary"
          type="submit"
        >
          保存并应用
        </button>
      </footer>
    </form>
  </dialog>
</template>
