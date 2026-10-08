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

<style scoped>
.loading-view {
  position: relative;
  z-index: 1;
  display: grid;
  min-height: 100vh;
  min-height: 100svh;
  align-content: center;
  justify-items: center;
  padding: 32px 24px;
  text-align: center;
}
.loading-ridge {
  width: min(180px, 54vw);
  margin-bottom: 28px;
}
.loading-ridge svg {
  display: block;
  width: 100%;
  overflow: visible;
  fill: none;
}
.loading-ridge path {
  stroke-linecap: round;
  stroke-linejoin: round;
}
.loading-ridge-shadow {
  stroke: hsl(var(--foreground) / 0.15);
  stroke-width: 1.15;
}
.loading-ridge-line {
  stroke: hsl(var(--foreground));
  stroke-width: 1.8;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: ridge-reveal 900ms cubic-bezier(0.22, 0.7, 0.28, 1) 120ms forwards;
}
.loading-copy {
  display: grid;
  justify-items: center;
}
.loading-brand {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.1em;
  line-height: 1.2;
}
.loading-copy strong {
  margin-top: 15px;
  font-size: 17px;
  font-weight: 650;
  letter-spacing: 0.02em;
}
.loading-copy small {
  margin-top: 6px;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
  letter-spacing: 0.04em;
}
.loading-progress {
  width: 112px;
  height: 2px;
  margin-top: 24px;
  overflow: hidden;
  border-radius: 999px;
  background: hsl(var(--foreground) / 0.12);
}
.loading-progress i {
  display: block;
  width: 32px;
  height: 100%;
  border-radius: inherit;
  background: hsl(var(--foreground));
  animation: horizon-travel 1.45s cubic-bezier(0.45, 0, 0.55, 1) infinite;
}
@keyframes ridge-reveal {
  to {
    stroke-dashoffset: 0;
  }
}
@keyframes horizon-travel {
  0% {
    transform: translateX(-34px);
    opacity: 0;
  }
  18%,
  82% {
    opacity: 1;
  }
  100% {
    transform: translateX(114px);
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .loading-ridge-line {
    animation: none;
    stroke-dashoffset: 0;
  }
  .loading-progress i {
    width: 100%;
    opacity: 0.56;
    animation: none;
  }
}
</style>
