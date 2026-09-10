/** Read the active theme only in the browser; series calculations stay DOM-independent. */
export function cssColor(variable: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
}
