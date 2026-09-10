import { computed, onScopeDispose, reactive, ref, watch } from "vue";
import { normalizeLayout } from "../domain/layout";
import { prepareBackground } from "../services/background";
import type { DashboardLayout, NodeSnapshot } from "../types";
interface SettingsActions {
  layout: () => DashboardLayout;
  nodes: () => NodeSnapshot[];
  persist: (layout: DashboardLayout) => boolean;
  reset: () => boolean;
  close: () => void;
  preview: (background: string | null) => void;
  notify: (message: string) => void;
}

/** Draft changes are isolated from saved preferences; only background selection previews live. */
export function useSettingsDraft(actions: SettingsActions) {
  const draft = reactive(normalizeLayout({}));
  const processing = ref(false),
    error = ref(""),
    imageError = ref("");
  const active = ref(false);
  let revision = 0;
  const status = computed(() =>
    processing.value
      ? "正在处理图片…"
      : draft.background !== actions.layout().background
        ? "预览中，保存后生效"
        : draft.background
          ? "当前为自定义背景"
          : "当前为默认背景",
  );
  watch(
    () => draft.background,
    (value) => {
      if (active.value) actions.preview(value);
    },
    { flush: "sync" },
  );
  function start() {
    revision++;
    processing.value = false;
    error.value = imageError.value = "";
    const nodes = actions.nodes();
    Object.assign(
      draft,
      normalizeLayout({
        ...actions.layout(),
        order: nodes.map((node) => node.id),
        nodes: Object.fromEntries(
          nodes.map((node) => [
            node.id,
            { label: node.label, role: node.role, country: node.country, region: node.region },
          ]),
        ),
      }),
    );
    active.value = true;
    actions.preview(draft.background);
  }
  function cancel() {
    revision++;
    active.value = false;
    processing.value = false;
    actions.preview(null);
    actions.close();
  }
  async function choose(file: File) {
    const epoch = ++revision;
    processing.value = true;
    error.value = imageError.value = "";
    try {
      const background = await prepareBackground(file);
      // Closing, resetting or selecting another file invalidates an in-flight decode.
      if (active.value && epoch === revision) draft.background = background;
    } catch (cause) {
      if (active.value && epoch === revision)
        imageError.value = cause instanceof Error ? cause.message : "图片处理失败，请重新选择。";
    } finally {
      if (epoch === revision) processing.value = false;
    }
  }
  function resetBackground() {
    revision++;
    processing.value = false;
    error.value = imageError.value = "";
    draft.background = "";
  }
  function move(id: string, offset: number) {
    const from = draft.order.indexOf(id),
      to = from + offset;
    if (from < 0 || to < 0 || to >= draft.order.length) return;
    [draft.order[from], draft.order[to]] = [draft.order[to], draft.order[from]];
  }
  function save() {
    if (processing.value) return;
    if (!actions.persist(normalizeLayout(draft))) {
      error.value =
        "未能保存：浏览器存储已满或不可用。请选择较小的图片，或允许此网站保存数据后重试。";
      return;
    }
    cancel();
    actions.notify("面板显示设置已保存到当前浏览器");
  }
  function reset() {
    if (!actions.reset()) {
      error.value = "未能恢复默认：浏览器存储不可用，请允许此网站保存数据后重试。";
      return;
    }
    cancel();
    actions.notify("已恢复默认显示");
  }
  onScopeDispose(() => {
    revision++;
    active.value = false;
    actions.preview(null);
  });
  return {
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
  };
}
