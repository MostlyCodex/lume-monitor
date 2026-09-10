<template>
  <div id="loading-view" class="loading-view" role="status" aria-live="polite" aria-busy="true">
    <div class="loading-ridge" aria-hidden="true">
      <svg viewBox="0 0 180 58" focusable="false">
        <path
          class="loading-ridge-shadow"
          pathLength="1"
          d="M3 47 C18 46 29 43 41 38 L58 25 L72 38 L101 9 L119 31 L134 23 L151 39 C160 44 169 46 177 47"
        />
        <path
          class="loading-ridge-line"
          pathLength="1"
          d="M3 47 C18 46 29 43 41 38 L58 25 L72 38 L101 9 L119 31 L134 23 L151 39 C160 44 169 46 177 47"
        />
      </svg>
    </div>
    <div class="loading-copy">
      <span class="loading-brand">Lume</span>
      <strong>正在连接监控网络</strong>
      <small>建立安全会话 · 同步节点状态</small>
    </div>
    <div class="loading-progress" aria-hidden="true"><i></i></div>
  </div>
</template>
