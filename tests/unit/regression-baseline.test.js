import { describe, expect, it } from "vitest";
import { collectFailureIds } from "../__baseline__/verify-no-regression.mjs";

function report(testResults) {
  return { testResults };
}

describe("regression baseline verifier", () => {
  it("uses repository-relative IDs for Windows and slash-normalized test paths", () => {
    const failures = collectFailureIds(
      report([
        {
          name: "tests/unit/windows-style.test.js",
          status: "failed",
          assertionResults: [
            { fullName: "Windows path rejects a regression", status: "failed" },
          ],
        },
        {
          name: "tests/unit/posix-style.test.js",
          status: "failed",
          assertionResults: [
            { fullName: "POSIX separators remain stable", status: "failed" },
          ],
        },
      ]),
    );

    expect(failures).toEqual([
      "tests/unit/posix-style.test.js :: POSIX separators remain stable",
      "tests/unit/windows-style.test.js :: Windows path rejects a regression",
    ]);
  });

  it("includes failed suites without a failed assertion", () => {
    expect(
      collectFailureIds(
        report([
          {
            name: "tests/unit/setup-failure.test.js",
            status: "failed",
            assertionResults: [{ fullName: "skipped after setup", status: "skipped" }],
          },
        ]),
      ),
    ).toEqual(["tests/unit/setup-failure.test.js :: [collection/setup failure]"]);
  });

  it("rejects malformed reports and tests outside the repository", () => {
    expect(() => collectFailureIds({})).toThrow("testResults[]");
    expect(() =>
      collectFailureIds(
        report([
          {
            name: "C:\\outside\\unexpected.test.js",
            status: "passed",
            assertionResults: [],
          },
        ]),
      ),
    ).toThrow("outside repository");
  });
});
