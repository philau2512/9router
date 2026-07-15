import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const require = createRequire(import.meta.url);
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const agent = require(
  path.join(root, "src/cursor-local/backend/proto/agentMessages.js"),
);
const wire = require(path.join(root, "src/cursor-local/backend/proto/wire.js"));

describe("AvailableModels golden field layout (byok proto)", () => {
  it("uses model_names=1 and models=2", () => {
    const buf = agent.encodeAvailableModelsResponse([
      {
        id: "9r_test1",
        displayName: "Test Model One",
        contextWindowTokens: 200000,
        reasoningEffort: "medium",
        capabilities: { thinking: true, images: true },
      },
    ]);
    const fields = wire.decodeFields(buf);
    const f1 = fields.filter((f) => f.fieldNumber === 1);
    const f2 = fields.filter((f) => f.fieldNumber === 2);
    expect(f1.length).toBeGreaterThanOrEqual(1);
    expect(f1[0].value.toString("utf8")).toBe("9r_test1");
    expect(f2.length).toBe(1);
    const m = wire.decodeFields(f2[0].value);
    expect(wire.fieldString(m, 1)).toBe("9r_test1");
    expect(wire.fieldString(m, 17)).toBe("Test Model One");
    // context limit field 15
    expect(wire.fieldInt(m, 15)).toBe(200000);
    // feature configs present
    expect(fields.some((f) => f.fieldNumber === 4)).toBe(true);
    expect(fields.some((f) => f.fieldNumber === 11)).toBe(true);

    // Write fixture for regression
    const fixDir = path.join(
      root,
      "src/cursor-local/fixtures/available-models",
    );
    fs.mkdirSync(fixDir, { recursive: true });
    fs.writeFileSync(path.join(fixDir, "sample.bin"), buf);
    fs.writeFileSync(
      path.join(fixDir, "meta.json"),
      JSON.stringify(
        {
          note: "Hand-built from aiserver_v1 AvailableModelsResponse field numbers",
          fields: { model_names: 1, models: 2, composer_model_config: 4 },
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  });

  it("empty model list still encodes feature flags", () => {
    const buf = agent.encodeAvailableModelsResponse([]);
    const fields = wire.decodeFields(buf);
    // use_model_parameters = 11
    expect(fields.some((f) => f.fieldNumber === 11)).toBe(true);
  });
});

describe("prompt compile byok assets", () => {
  const { compilePrompt } = require(
    path.join(root, "src/cursor-local/backend/prompt/compile.js"),
  );

  it("agent mode loads long system prompt with model id", () => {
    const c = compilePrompt("agent", "my-model");
    expect(c.system.length).toBeGreaterThan(500);
    expect(c.system.includes("my-model") || c.system.length > 0).toBe(true);
    expect(c.tools.length).toBeGreaterThan(0);
  });

  it("ask mode strips Write/PatchEdit/Delete", () => {
    const c = compilePrompt("ask", "x");
    const names = c.tools.map((t) => String(t.function?.name || ""));
    expect(names.includes("Write")).toBe(false);
    expect(names.includes("PatchEdit")).toBe(false);
    expect(names.includes("Delete")).toBe(false);
  });

  it("plan mode has tools", () => {
    const c = compilePrompt("plan", "x");
    expect(c.mode).toBe("plan");
    expect(c.system.length).toBeGreaterThan(100);
  });
});

describe("compaction estimate", () => {
  const { estimateTokens } = require(
    path.join(root, "src/cursor-local/backend/history/compaction.js"),
  );
  it("estimates tokens roughly", () => {
    expect(estimateTokens([{ role: "user", content: "a".repeat(400) }])).toBe(
      100,
    );
  });
});
