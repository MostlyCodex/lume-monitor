import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

export class InputError extends Error {}
export class PromptCancelled extends Error {}
export class PromptBack extends PromptCancelled {}
export class PromptClosed extends PromptCancelled {}

function navigation(value) {
  if (value === "/cancel") throw new PromptCancelled();
  if (value === "/back") throw new PromptBack();
  return value;
}

// Forms contain input only. Going back never replays deployment or file writes.
export async function promptFields(fields, { line = console.log } = {}) {
  const values = {};
  let index = 0;
  line("输入 /back 返回上一项，/cancel 取消本次填写。");
  while (index < fields.length) {
    const [key, ask, enabled = () => true] = fields[index];
    if (!enabled(values)) { delete values[key]; index += 1; continue; }
    try {
      values[key] = await ask(values, values[key]);
      index += 1;
    } catch (error) {
      if (!(error instanceof PromptBack)) throw error;
      do { index -= 1; } while (index >= 0 && fields[index][2] && !fields[index][2](values));
      if (index < 0) throw error;
      line("已返回上一项，回车保留已填内容。");
    }
  }
  return values;
}

// Only field validation errors are retried. I/O errors and cancellation still
// propagate, so a closed terminal cannot leave an unattended infinite loop.
export async function inputValue(prompt, question, { hint, fallback = "", parse = (value) => value, secret = false, line = console.log } = {}) {
  while (true) {
    const value = navigation(await prompt[secret ? "secret" : "text"](question, fallback, { hint }));
    try { return await parse(value); }
    catch (error) {
      if (!(error instanceof InputError)) throw error;
      line(`输入无效：${error.message}。请重新填写当前项。`);
    }
  }
}

export function choiceValue(prompt, question, choices, fallback = "", { line = console.log, showChoices = true } = {}) {
  return inputValue(prompt, question, {
    hint: showChoices ? `可选：${choices.join(" / ")}${choices.some((choice) => /[a-z]/i.test(choice)) ? "，不区分大小写" : ""}` : undefined, fallback, line,
    parse: (value) => {
      const selected = value.toLowerCase();
      if (!choices.includes(selected)) throw new InputError(`只能选择 ${choices.join(" / ")}`);
      return selected;
    },
  });
}

export function integerValue(prompt, question, min, max, fallback, { line = console.log } = {}) {
  return inputValue(prompt, question, {
    hint: `${min}–${max} 的十进制整数`, fallback: String(fallback), line,
    parse: (value) => {
      const number = Number(value);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) {
        throw new InputError(`必须是 ${min}–${max} 的十进制整数`);
      }
      return number;
    },
  });
}

export function displayText(value, { label = "显示文字", max = 80, optional = false } = {}) {
  if ((!value && !optional) || Buffer.byteLength(value) > max || /[\x00-\x1f\x7f]/.test(value)) {
    throw new InputError(`${label}${optional ? "可留空，否则" : "不能为空，且"}最多 ${max} 字节，不能包含控制字符`);
  }
  return value;
}

export function displayValue(prompt, question, fallback = "", { max = 80, optional = false, line = console.log } = {}) {
  return inputValue(prompt, question, {
    hint: `仅用于显示，可自定义；${optional ? "可留空；" : ""}最多 ${max} 字节（中文通常每字 3 字节）`, fallback, line,
    parse: (value) => displayText(value, { label: question, max, optional }),
  });
}

export function booleanValue(value) {
  if (["y", "yes", "是"].includes(value.toLowerCase())) return true;
  if (["n", "no", "否"].includes(value.toLowerCase())) return false;
  throw new InputError("只能输入 y / yes / 是，或 n / no / 否");
}

export function makePrompter({ input = process.stdin, output = process.stdout } = {}) {
  let muted = false;
  const destination = new Writable({ write(chunk, encoding, done) { if (!muted) output.write(chunk, encoding); done(); } });
  const interface_ = createInterface({ input, output: destination, terminal: Boolean(input.isTTY) });
  let closed = false;
  let pending;
  interface_.on("close", () => { closed = true; pending?.abort(new PromptClosed()); });
  interface_.on("SIGINT", () => pending?.abort(new PromptCancelled()));
  async function ask(question, fallback, { hint, secret = false } = {}) {
    if (closed) throw new PromptClosed();
    if (hint) output.write(`  ${hint}\n`);
    const suffix = secret ? "（输入不显示）" : fallback ? ` [${fallback}]` : "";
    const controller = new AbortController();
    pending = controller;
    try {
      if (secret) { output.write(`${question}${suffix}: `); muted = true; }
      const value = await interface_.question(secret ? "" : `${question}${suffix}: `, { signal: controller.signal });
      return navigation(value.trim() || fallback);
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      pending = undefined;
      muted = false;
      output.write(`${secret || !input.isTTY || controller.signal.aborted ? "\n" : ""}────────────────────────────────\n`);
    }
  }
  const prompt = {
    async secret(question, _fallback = "", options = {}) {
      return ask(question, "", { ...options, secret: true });
    },
    async text(question, fallback = "", options = {}) {
      return ask(question, fallback, options);
    },
    async yes(question, fallback = false) {
      return inputValue(prompt, question, {
        hint: "y / yes / 是，或 n / no / 否", fallback: fallback ? "y" : "n", parse: booleanValue,
        line: (message) => output.write(`${message}\n`),
      });
    },
    close() { interface_.close(); },
  };
  return prompt;
}
