import { test } from "node:test";
import assert from "node:assert/strict";
import { EstimateCache } from "../src/estimate-cache.js";
import { unknownCost } from "../shared/pricing.js";

test("adding and reselecting models reuses completed prices; parameter changes fetch again", async () => {
  const cache = new EstimateCache();
  const calls: string[] = [];
  const fetch = (key: string) =>
    cache.get(key, async () => {
      calls.push(key);
      return unknownCost();
    });
  await fetch("A:params1");
  await Promise.all([fetch("A:params1"), fetch("B:params1")]);
  await fetch("A:params1");
  assert.deepEqual(calls, ["A:params1", "B:params1"]);
  await fetch("A:params2");
  assert.deepEqual(calls, ["A:params1", "B:params1", "A:params2"]);
});

test("selection changes during loading share in-flight requests", async () => {
  const cache = new EstimateCache();
  let resolve!: (value: ReturnType<typeof unknownCost>) => void;
  let calls = 0;
  const load = () => {
    calls++;
    return new Promise<ReturnType<typeof unknownCost>>((done) => {
      resolve = done;
    });
  };
  const first = cache.get("A", load);
  const second = cache.get("A", load);
  assert.equal(first, second);
  assert.equal(calls, 1);
  resolve(unknownCost());
  await first;
  assert.ok(cache.read("A"));
});
