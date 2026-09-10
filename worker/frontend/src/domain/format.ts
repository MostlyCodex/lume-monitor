export function clamp(value: unknown, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

export function formatPercent(value: unknown, digits = 1) {
  const numeric = clamp(value, 0, 100);
  return `${numeric.toFixed(digits)}%`;
}

export function formatLoss(value: unknown) {
  const numeric = clamp(value, 0, 100);
  return `${Number.isInteger(numeric) ? numeric.toFixed(0) : numeric.toFixed(1)}%`;
}

export function formatAge(seconds: unknown) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  if (value < 60) return `${value} 秒前`;
  if (value < 3600) return `${Math.floor(value / 60)} 分钟前`;
  if (value < 86400) return `${Math.floor(value / 3600)} 小时前`;
  return `${Math.floor(value / 86400)} 天前`;
}

export function formatInterval(seconds: unknown) {
  const value = Math.max(1, Math.round(Number(seconds) || 0));
  if (value % 3600 === 0) return `${value / 3600} 小时`;
  if (value % 60 === 0) return `${value / 60} 分钟`;
  return `${value} 秒`;
}

export function formatUptime(seconds: unknown) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  return `${hours} 小时 ${Math.floor((value % 3600) / 60)} 分`;
}

export function formatBytes(value: unknown, units = ["B", "KB", "MB", "GB", "TB", "PB"]) {
  let bytes = Math.max(0, Number(value) || 0);
  let index = 0;
  while (bytes >= 1024 && index < units.length - 1) {
    bytes /= 1024;
    index += 1;
  }
  return `${bytes.toFixed(index > 2 ? 2 : 1)} ${units[index]}`;
}

export function formatCapacity(value: unknown) {
  const bytes = Number(value);
  return Number.isFinite(bytes) && bytes > 0
    ? formatBytes(bytes, ["B", "KiB", "MiB", "GiB", "TiB", "PiB"])
    : "—";
}

export function formatRate(value: unknown) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return `${formatBytes(value)}/s`;
}

export function formatTime(timestamp: unknown, includeDate = false) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: includeDate ? "2-digit" : undefined,
    day: includeDate ? "2-digit" : undefined,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(Number(timestamp) * 1000));
}

export function formatAxisTime(timestamp: number, hours: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: hours > 24 ? "2-digit" : undefined,
    day: hours > 24 ? "2-digit" : undefined,
    hour: hours <= 720 ? "2-digit" : undefined,
    minute: hours <= 24 ? "2-digit" : undefined,
    hour12: false,
  }).format(new Date(Number(timestamp) * 1000));
}
