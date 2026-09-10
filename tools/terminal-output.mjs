// Share boundaries between prompts, command output and operation results.
// Repeated finalizers must not produce adjacent divider lines.
const terminals = new WeakMap();
export const divider = "────────────────────────────────";

export function terminalFor(output = process.stdout) {
  if (terminals.has(output)) return terminals.get(output);
  let separated = true, endsLine = true;
  const terminal = {
    write(value) { separated = false; endsLine = String(value).endsWith("\n"); output.write(value); },
    line(value = "") { terminal.write(`${value}\n`); },
    markOutput() { separated = false; },
    separate() {
      if (separated) return;
      output.write(`${endsLine ? "" : "\n"}${divider}\n`);
      endsLine = true;
      separated = true;
    },
  };
  terminals.set(output, terminal);
  return terminal;
}
