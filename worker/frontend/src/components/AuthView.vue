<script setup lang="ts">
import { computed } from "vue";
defineProps<{ brand: string }>();
const emit = defineEmits<{ notify: [message: string, error?: boolean] }>();
const message = computed(() => {
  const reason = new URLSearchParams(location.search).get("login");
  return reason === "expired"
    ? "登录链接已过期或已使用，请重新发送 /panel。"
    : reason === "error"
      ? "登录暂时未完成，请重新获取一次性链接。"
      : "";
});
async function copyCommand() {
  try {
    await navigator.clipboard.writeText("/panel");
    emit("notify", "已复制 /panel");
  } catch {
    emit("notify", "请手动在 Telegram 中发送 /panel", true);
  }
}
</script>
<template>
  <main id="auth-view" class="auth-shell">
    <section class="auth-card glass-panel" aria-labelledby="auth-title">
      <div class="brand-lockup">
        <div>
          <strong data-dashboard-brand>{{ brand }}</strong
          ><span>MINIMAL OBSERVABILITY</span>
        </div>
      </div>
      <div class="auth-copy">
        <span class="status-pill is-healthy"><i></i> Telegram 安全登录</span>
        <h1 id="auth-title">线路状态，<br />一眼看清。</h1>
        <p>
          请在已绑定的 Telegram 私密群或机器人私聊中发送 <code>/panel</code>，使用一次性链接登录。
        </p>
      </div>
      <ol class="login-steps">
        <li>
          <span>01</span>
          <div><strong>发送命令</strong><small>在 Telegram 中发送 /panel</small></div>
        </li>
        <li>
          <span>02</span>
          <div><strong>打开链接</strong><small>链接 5 分钟有效且仅可使用一次</small></div>
        </li>
        <li>
          <span>03</span>
          <div><strong>保持登录</strong><small>安全会话在当前浏览器保留 30 天</small></div>
        </li>
      </ol>
      <div id="login-message" class="login-message" :class="{ 'is-hidden': !message }" role="alert">
        {{ message }}
      </div>
      <div class="auth-actions">
        <button
          id="copy-panel-command"
          @click="copyCommand"
          class="button button-primary"
          type="button"
        >
          复制 /panel
        </button>
        <a class="button button-ghost" href="https://web.telegram.org/" rel="noreferrer"
          >打开 Telegram</a
        >
      </div>
    </section>
    <aside class="auth-visual glass-panel" aria-hidden="true">
      <div class="auth-visual-top"><span>LIVE NETWORK</span><i></i></div>
      <div class="auth-visual-score"><strong>99.8</strong><small>% HEALTH</small></div>
      <div class="auth-pulse-line">
        <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
      </div>
      <div class="auth-node-list">
        <div><i></i><span>Transit</span><b>ONLINE</b></div>
        <div><i></i><span>Egress</span><b>ONLINE</b></div>
        <div><i></i><span>Standby</span><b>READY</b></div>
      </div>
    </aside>
  </main>
</template>
