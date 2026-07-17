/**
 * grok-cli models must resolve via getModelsByProviderId.
 * Regression: OAUTH_ALIASES maps grok-cli → gcli but PROVIDER_MODELS is keyed
 * by "grok-cli", so a naive alias-only lookup returned [] and the Grok Build
 * detail page showed no model list.
 */
import { describe, it, expect } from "vitest";
import {
  getModelsByProviderId,
  PROVIDER_ID_TO_ALIAS,
  PROVIDER_MODELS,
} from "../../open-sse/config/providerModels.js";

describe("getModelsByProviderId — grok-cli / gcli", () => {
  it("maps provider id grok-cli to alias gcli", () => {
    expect(PROVIDER_ID_TO_ALIAS["grok-cli"]).toBe("gcli");
  });

  it("catalog is stored under grok-cli id (not only gcli)", () => {
    expect(PROVIDER_MODELS["grok-cli"]?.length).toBeGreaterThan(0);
  });

  it("returns Grok Build models for provider id grok-cli", () => {
    const models = getModelsByProviderId("grok-cli");
    expect(models.length).toBeGreaterThan(0);
    expect(models.map((m) => m.id)).toEqual(
      expect.arrayContaining(["grok-build", "grok-4.5"]),
    );
  });

  it("returns same catalog for short alias gcli", () => {
    const byId = getModelsByProviderId("grok-cli");
    const byAlias = getModelsByProviderId("gcli");
    expect(byAlias.map((m) => m.id)).toEqual(byId.map((m) => m.id));
  });

  it("xai catalog remains separate (api.x.ai models)", () => {
    const xai = getModelsByProviderId("xai");
    const gcli = getModelsByProviderId("grok-cli");
    expect(xai.length).toBeGreaterThan(0);
    // Distinct pipelines — lists must not be identical by accident
    expect(xai.map((m) => m.id).sort().join(",")).not.toBe(
      gcli.map((m) => m.id).sort().join(","),
    );
  });
});