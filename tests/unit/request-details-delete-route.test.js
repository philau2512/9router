import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteAllRequestDetails: vi.fn(),
}));

vi.mock("@/lib/usageDb", () => ({
  getRequestDetails: vi.fn(),
  getRequestDetailsList: vi.fn(),
  getRequestDetailById: vi.fn(),
  deleteAllRequestDetails: mocks.deleteAllRequestDetails,
}));

import { DELETE } from "../../src/app/api/usage/request-details/route.js";

describe("DELETE /api/usage/request-details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes only request details and returns the deletion count", async () => {
    mocks.deleteAllRequestDetails.mockResolvedValue(300);

    const response = await DELETE();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: 300 });
    expect(mocks.deleteAllRequestDetails).toHaveBeenCalledOnce();
  });

  it("returns 500 when detail deletion fails", async () => {
    mocks.deleteAllRequestDetails.mockRejectedValue(
      new Error("database unavailable"),
    );

    const response = await DELETE();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to delete request details",
    });
  });
});