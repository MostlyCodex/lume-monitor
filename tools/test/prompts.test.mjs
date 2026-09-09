import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { InputError, booleanValue, inputValue, integerValue, makePrompter } from "../prompts.mjs";

test("confirmation retries unknown answers instead of treating them as no", async () => {
  const input = new PassThrough(), output = new PassThrough();
  let transcript = "";
  output.on("data", (chunk) => { transcript += chunk; });
  const prompt = makePrompter({ input, output });
  try {
    const answer = prompt.yes("保存配置", true);
    input.write("maybe\n");
    await new Promise(setImmediate);
    assert.match(transcript, /输入无效/);
    assert.equal(transcript.match(/保存配置/g).length, 2);
    input.write("\n");
    assert.equal(await answer, true);
    for (const value of ["n", "NO", "否"]) assert.equal(booleanValue(value), false);
    for (const value of ["y", "YES", "是"]) assert.equal(booleanValue(value), true);
  } finally { prompt.close(); input.end(); output.end(); }
});

test("integer fields display their range and retry decimals, exponent notation and out-of-range values", async () => {
  for (const boundary of ["1", "65535"]) {
    const answers = ["0", "65536", "1.5", "1e3", "0x1bb", boundary], errors = [], questions = [];
    const value = await integerValue({ text: async (question) => { questions.push(question); return answers.shift(); } }, "端口", 1, 65535, 443, { line: (message) => errors.push(message) });
    assert.equal(value, Number(boundary));
    assert.equal(errors.length, 5);
    assert.ok(questions.every((question) => question.includes("1–65535")));
  }
});

test("validation retries cannot swallow terminal cancellation or unexpected execution errors", async () => {
  const cancelled = Object.assign(new Error("cancelled"), { name: "AbortError" });
  await assert.rejects(inputValue({ text: async () => { throw cancelled; } }, "字段"), (error) => error === cancelled);
  await assert.rejects(inputValue({ text: async () => "value" }, "字段", { parse: () => { throw Error("I/O failure"); } }), /I\/O failure/);
});

test("secret validation reports the requirement without echoing the rejected credential", async () => {
  const answers = ["private-token\tbad", "valid-token"], errors = [];
  const result = await inputValue({ secret: async () => answers.shift() }, "令牌", {
    secret: true, line: (message) => errors.push(message),
    parse: (value) => { if (/\t/.test(value)) throw new InputError("令牌不能包含控制字符"); return value; },
  });
  assert.equal(result, "valid-token");
  assert.equal(errors.length, 1);
  assert.ok(!errors.join().includes("private-token"));
});
