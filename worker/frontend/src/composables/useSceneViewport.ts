import { onMounted, onScopeDispose, type Ref } from "vue";

/** Ignore mobile browser chrome resizing so the background doesn't zoom while scrolling. */
export function useSceneViewport(scene: Ref<HTMLElement | null>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stable = () =>
    matchMedia("(pointer: coarse)").matches &&
    Math.min(screen.width || innerWidth, screen.height || innerHeight) <= 1024;
  function lock() {
    if (!scene.value) return;
    const long = Math.max(screen.width || innerWidth, screen.height || innerHeight);
    const short = Math.min(screen.width || innerWidth, screen.height || innerHeight);
    const landscape = innerWidth > innerHeight;
    const width = stable() ? Math.max(innerWidth, landscape ? long : short) : innerWidth;
    const height = stable() ? Math.max(innerHeight, landscape ? short : long) : innerHeight;
    scene.value.style.setProperty("--scene-lock-width", `${Math.ceil(width)}px`);
    scene.value.style.setProperty("--scene-lock-height", `${Math.ceil(height)}px`);
  }
  const schedule = (delay = 0) => {
    clearTimeout(timer);
    timer = setTimeout(lock, delay);
  };
  const resize = () => {
    if (!stable()) schedule();
  };
  const orient = () => schedule(240);
  const show = () => schedule();
  onMounted(() => {
    lock();
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("orientationchange", orient);
    screen.orientation?.addEventListener("change", orient);
    window.addEventListener("pageshow", show);
  });
  onScopeDispose(() => {
    clearTimeout(timer);
    window.removeEventListener("resize", resize);
    window.removeEventListener("orientationchange", orient);
    screen.orientation?.removeEventListener("change", orient);
    window.removeEventListener("pageshow", show);
  });
}
