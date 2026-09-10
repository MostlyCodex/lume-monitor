import { onScopeDispose, reactive } from "vue";
export function useToast() {
  const toast = reactive({ message: "", error: false });
  let timer: ReturnType<typeof setTimeout> | undefined;
  function notify(message: string, error = false) {
    clearTimeout(timer);
    Object.assign(toast, { message, error });
    timer = setTimeout(() => {
      toast.message = "";
    }, 3200);
  }
  onScopeDispose(() => clearTimeout(timer));
  return { toast, notify };
}
