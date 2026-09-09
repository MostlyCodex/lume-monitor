import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

export class InputError extends Error {}

// Only field validation errors are retried. I/O errors and cancellation still
// propagate, so a closed terminal cannot leave an unattended infinite loop.
export async function inputValue(prompt, question, { hint, fallback = "", parse = (value) => value, secret = false, line = console.log } = {}) {
  while (true) {
    const label = hint ? `${question}（${hint}）` : question;
    const value = await prompt[secret ? "secret" : "text"](label, fallback);
    try { return await parse(value); }
    catch (error) {
      if (!(error instanceof InputError)) throw error;
      line(`输入无效：${error.message}。请重新填写当前项。`);
    }
  }
}

export function choiceValue(prompt, question, choices, fallback = "", { line = console.log } = {}) {
  return inputValue(prompt, question, {
    hint: `可选：${choices.join(" / ")}${choices.some((choice) => /[a-z]/i.test(choice)) ? "，不区分大小写" : ""}`, fallback, line,
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
  const prompt = {
    async secret(question) {
      output.write(`${question}（输入不显示）: `);
      muted = true;
      try { return (await interface_.question("")).trim(); }
      finally { muted = false; output.write("\n"); }
    },
    async text(question, fallback = "") {
      const suffix = fallback ? ` [${fallback}]` : "";
      const value = (await interface_.question(`${question}${suffix}: `)).trim();
      return value || fallback;
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
