import { describe, expect, it } from "vitest";
import {
  isLiveOnlyModelProvider,
  mergeProviderModels,
  normalizeCatalogModel,
} from "../../src/shared/utils/mergeProviderModels.js";

describe("mergeProviderModels", () => {
  const staticKiro = [
    { id: "claude-opus-4.8", name: "Claude Opus 4.8" },
    { id: "auto", name: "Auto" },
    { id: "deepseek-3.2", name: "Deepseek v3.2 (static)" },
  ];
  const liveKiro = [
    { id: "deepseek-3.2", name: "Kiro Deepseek v3.2 (0.3x credit)" },
    { id: "minimax-m2.5", name: "Kiro MiniMax M2.5" },
    { id: "glm-5", name: "Kiro GLM 5" },
  ];

  it("kiro live-only: available = live; static missing → shelved (Disabled)", () => {
    expect(isLiveOnlyModelProvider("kiro")).toBe(true);
    const { models, shelvedModels } = mergeProviderModels({
      providerId: "kiro",
      staticModels: staticKiro,
      liveModels: liveKiro,
    });
    expect(models.map((m) => m.id)).toEqual([
      "deepseek-3.2",
      "minimax-m2.5",
      "glm-5",
    ]);
    expect(shelvedModels.map((m) => m.id).sort()).toEqual([
      "auto",
      "claude-opus-4.8",
    ]);
    expect(shelvedModels.every((m) => m.accountUnavailable === true)).toBe(
      true,
    );
    expect(models.find((m) => m.id === "deepseek-3.2")?.name).toContain("Kiro");
  });

  it("kiro falls back to static when live empty/null (no shelved)", () => {
    expect(
      mergeProviderModels({
        providerId: "kiro",
        staticModels: staticKiro,
        liveModels: [],
      }),
    ).toEqual({ models: staticKiro, shelvedModels: [] });

    expect(
      mergeProviderModels({
        providerId: "kiro",
        staticModels: staticKiro,
        liveModels: null,
      }),
    ).toEqual({ models: staticKiro, shelvedModels: [] });
  });

  it("non-kiro providers still union static + live", () => {
    expect(isLiveOnlyModelProvider("codex")).toBe(false);
    const { models, shelvedModels } = mergeProviderModels({
      providerId: "codex",
      staticModels: [
        { id: "gpt-5", name: "GPT-5 static" },
        { id: "o3", name: "o3" },
      ],
      liveModels: [
        { id: "gpt-5", name: "GPT-5 live" },
        { id: "gpt-5.4", name: "GPT-5.4" },
      ],
    });
    expect(shelvedModels).toEqual([]);
    const byId = Object.fromEntries(models.map((m) => [m.id, m.name]));
    expect(byId["gpt-5"]).toBe("GPT-5 live");
    expect(byId.o3).toBe("o3");
    expect(byId["gpt-5.4"]).toBe("GPT-5.4");
  });

  it("normalizeCatalogModel accepts string / id / name / model", () => {
    expect(normalizeCatalogModel("x")).toEqual({ id: "x", name: "x" });
    expect(normalizeCatalogModel({ model: "y", name: "Y" }).id).toBe("y");
    expect(normalizeCatalogModel(null)).toBeNull();
  });
});