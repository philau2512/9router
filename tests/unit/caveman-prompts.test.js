import { describe, expect, it } from "vitest";

import {
  CAVEMAN_LEVELS,
  CAVEMAN_PROMPTS,
} from "../../open-sse/rtk/cavemanPrompts.js";

describe("caveman prompts", () => {
  it("defines prompts for every exported level", () => {
    for (const level of Object.values(CAVEMAN_LEVELS)) {
      expect(CAVEMAN_PROMPTS[level], level).toBeTypeOf("string");
      expect(CAVEMAN_PROMPTS[level].length, level).toBeGreaterThan(0);
    }
  });

  it("includes Wenyan levels with shared preservation rules", () => {
    expect(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.WENYAN_LITE]).toContain("文言文");
    expect(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.WENYAN]).toContain("Dense wenyan");
    expect(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.WENYAN_ULTRA]).toContain(
      "Maximum density",
    );
    expect(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.WENYAN]).toContain(
      "Technical terms in original form",
    );
  });
});
