import { test } from "node:test";
import assert from "node:assert/strict";
import { initialModels } from "../src/model-selection.js";
import type { Settings } from "../shared/types.js";

const settings: Settings = {
  providers: [
    {
      id: "p",
      name: "Provider",
      type: "openai",
      baseUrl: "https://example.com",
      hasKey: true,
      models: [
        ...Array.from({ length: 12 }, (_, i) => ({
          id: String(i),
          name: String(i),
          kind: "image" as const,
          canEdit: false,
        })),
        { id: "text", name: "Text", kind: "text", canEdit: false },
      ],
    },
  ],
  textModel: null,
  defaultImageModel: { providerId: "p", modelId: "0" },
};
test("last submitted selection wins over default; invalid entries are discarded", () => {
  assert.deepEqual(
    initialModels(
      settings,
      JSON.stringify(["p|2", "p|text", "deleted|1", "p|2", "p|1"]),
    ),
    ["p|2", "p|1"],
  );
  assert.equal(
    initialModels(
      settings,
      JSON.stringify(Array.from({ length: 12 }, (_, i) => "p|" + i)),
    ).length,
    10,
  );
});
test("missing, corrupt, empty or fully deleted history uses valid default", () => {
  for (const stored of [null, "broken", "{}", "[]", '["p|text","gone|1"]'])
    assert.deepEqual(initialModels(settings, stored), ["p|0"]);
  assert.deepEqual(
    initialModels({ ...settings, defaultImageModel: null }, null),
    [],
  );
  assert.deepEqual(
    initialModels(
      { ...settings, defaultImageModel: { providerId: "p", modelId: "gone" } },
      null,
    ),
    [],
  );
});
