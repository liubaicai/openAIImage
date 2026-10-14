import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateImageCost, costLabel } from "../shared/pricing.js";
import { defaultOptions } from "../shared/types.js";

test("explicit per-image and per-request units follow actual one-image requests", () => {
  for (const unit of ["image", "request"]) {
    const result = estimateImageCost(
      [{ pricing: [{ billable: "output_image", unit, cost_usd: 0.04 }] }],
      { ...defaultOptions, count: 3 },
      "hello",
    );
    assert.equal(result.minUsd, 0.12);
    assert.equal(result.maxUsd, 0.12);
    assert.equal(result.partial, false);
  }
});
test("missing, invalid and ambiguous prices are never presented as free", () => {
  for (const pricing of [
    [],
    [{ billable: "output_image", unit: "unknown", cost_usd: 0.1 }],
    [{ billable: "output_image", unit: "image", cost_usd: -1 }],
  ]) {
    assert.equal(
      estimateImageCost([{ pricing }], defaultOptions, "").minUsd,
      null,
    );
  }
  const free = estimateImageCost(
    [{ pricing: [{ billable: "output_image", unit: "image", cost_usd: 0 }] }],
    defaultOptions,
    "",
  );
  assert.equal(costLabel(free), "约 $0");
});
test("preserves routing and unresolved resolution ranges and flags incomplete routes", () => {
  const result = estimateImageCost(
    [
      {
        pricing: [
          {
            billable: "output_image",
            unit: "image",
            cost_usd: 0.04,
            variant: "high/1k",
          },
          {
            billable: "output_image",
            unit: "image",
            cost_usd: 0.16,
            variant: "high/4k",
          },
          {
            billable: "output_image",
            unit: "image",
            cost_usd: 0.01,
            variant: "low/1k",
          },
        ],
      },
      { pricing: [] },
    ],
    { ...defaultOptions, quality: "high", count: 2 },
    "",
  );
  assert.equal(result.minUsd, 0.08);
  assert.equal(result.maxUsd, 0.32);
  assert.equal(result.partial, true);
});
test("token estimates count repeated prompts and increase with quantity", () => {
  const endpoints = [
    {
      pricing: [
        { billable: "output_image", unit: "token", cost_usd: 0.00003 },
        { billable: "input_text", unit: "token", cost_usd: 0.000002 },
      ],
    },
  ];
  const one = estimateImageCost(endpoints, defaultOptions, "测试提示词");
  const four = estimateImageCost(
    endpoints,
    { ...defaultOptions, count: 4 },
    "测试提示词",
  );
  assert.equal(four.minUsd, one.minUsd! * 4);
  assert.equal(four.maxUsd, one.maxUsd! * 4);
  assert.ok(one.maxUsd! > one.minUsd!);
  assert.match(one.detail, /不是费用上限/);
});
test("megapixel prices include rounding allowance and unknown extras remain partial", () => {
  const result = estimateImageCost(
    [
      {
        pricing: [
          { billable: "output_image", unit: "megapixel", cost_usd: 0.03 },
          { billable: "tool", unit: "request", cost_usd: 0.1 },
        ],
      },
    ],
    { ...defaultOptions, size: "1536x1024" },
    "",
  );
  assert.equal(result.minUsd, 0.03);
  assert.equal(result.maxUsd, 0.06);
  assert.equal(result.partial, true);
});
