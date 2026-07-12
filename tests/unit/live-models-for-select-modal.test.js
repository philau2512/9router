import { describe, expect, it } from "vitest";
import {
  applyLiveCatalogToChips,
  normalizeLiveCatalogList,
  parseProviderModelsPayload,
  pickFirstActiveConnectionByProvider,
} from "../../src/shared/utils/liveModelsForSelectModal.js";

describe("liveModelsForSelectModal", () => {
  it("parseProviderModelsPayload accepts common shapes", () => {
    expect(parseProviderModelsPayload({ models: [{ id: "a" }] })).toEqual([
      { id: "a" },
    ]);
    expect(parseProviderModelsPayload({ data: ["b"] })).toEqual(["b"]);
    expect(parseProviderModelsPayload([{ id: "c" }])).toEqual([{ id: "c" }]);
    expect(parseProviderModelsPayload({})).toEqual([]);
  });

  it("pickFirstActiveConnectionByProvider keeps first active per provider", () => {
    const map = pickFirstActiveConnectionByProvider([
      { id: "1", provider: "kiro", isActive: true },
      { id: "2", provider: "kiro", isActive: true },
      { id: "3", provider: "codex", isActive: false },
      { id: "4", provider: "codex" },
    ]);
    expect(map.get("kiro")?.id).toBe("1");
    expect(map.get("codex")?.id).toBe("4");
    expect(map.size).toBe(2);
  });

  it("applyLiveCatalogToChips fail-open when live empty", () => {
    const staticChips = [
      { id: "auto", name: "Auto", value: "kr/auto" },
      { id: "claude-sonnet-4.5", name: "Sonnet", value: "kr/claude-sonnet-4.5" },
    ];
    expect(
      applyLiveCatalogToChips({
        providerId: "kiro",
        valuePrefix: "kr",
        staticChips,
        liveModels: [],
      }),
    ).toEqual(staticChips);
    expect(
      applyLiveCatalogToChips({
        providerId: "kiro",
        valuePrefix: "kr",
        staticChips,
        liveModels: null,
      }),
    ).toEqual(staticChips);
  });

  it("kiro live-only replaces static and keeps custom", () => {
    const staticChips = [
      { id: "auto", name: "Auto", value: "kr/auto" },
      { id: "claude-sonnet-4.5", name: "Sonnet", value: "kr/claude-sonnet-4.5" },
      {
        id: "my-custom",
        name: "My Custom",
        value: "kr/my-custom",
        isCustom: true,
      },
    ];
    const live = normalizeLiveCatalogList([
      { id: "deepseek-3.2", name: "Kiro Deepseek" },
      { id: "minimax-m2.5", name: "Kiro MiniMax" },
    ]);
    const out = applyLiveCatalogToChips({
      providerId: "kiro",
      valuePrefix: "kr",
      staticChips,
      liveModels: live,
    });
    expect(out.map((m) => m.id).sort()).toEqual([
      "deepseek-3.2",
      "minimax-m2.5",
      "my-custom",
    ]);
    expect(out.find((m) => m.id === "deepseek-3.2")?.value).toBe(
      "kr/deepseek-3.2",
    );
    expect(out.find((m) => m.id === "my-custom")?.isCustom).toBe(true);
  });

  it("union providers keep static + add live", () => {
    const staticChips = [
      { id: "gpt-5", name: "GPT-5 static", value: "cx/gpt-5" },
      { id: "o3", name: "o3", value: "cx/o3" },
    ];
    const out = applyLiveCatalogToChips({
      providerId: "codex",
      valuePrefix: "cx",
      staticChips,
      liveModels: [
        { id: "gpt-5", name: "GPT-5 live" },
        { id: "gpt-5.4", name: "GPT-5.4" },
      ],
    });
    const byId = Object.fromEntries(out.map((m) => [m.id, m]));
    expect(byId["gpt-5"].name).toBe("GPT-5 live");
    expect(byId.o3.name).toBe("o3");
    expect(byId["gpt-5.4"].value).toBe("cx/gpt-5.4");
  });
});