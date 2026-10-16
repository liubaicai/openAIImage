import test from "node:test";
import assert from "node:assert/strict";
import { aspectRatio, generationPrompt } from "../shared/generation-options.js";
import { defaultOptions, imageSizes } from "../shared/types.js";

test("all supported dimensions retain exact ratios, including legacy sizes", () => {
  assert.deepEqual(imageSizes.map(aspectRatio), [
    "1:1", "3:2", "2:3", "16:9", "9:16", "4:3", "3:4", "4:5", "5:4",
  ]);
});

test("output instructions preserve style and auto settings without inventing quality", () => {
  const prompt = "低饱和、柔焦水彩，保留画中的标题文字";
  const auto = generationPrompt(prompt, defaultOptions);
  assert.ok(auto.startsWith(prompt + "\n\n"));
  assert.doesNotMatch(auto, /高画质|标准画质|草稿画质|透明背景/);
  const high = generationPrompt(prompt, { ...defaultOptions, size: "1152x1536", quality: "high", background: "transparent" });
  assert.match(high, /3:4/);
  assert.match(high, /1152 × 1536/);
  assert.match(high, /透明背景/);
  assert.match(high, /保留原提示词的内容与艺术风格/);
});
