import { NextResponse } from "next/server";
import { getCursorLocalStatus } from "@/lib/cursor-local/manager";
import { isCursorLocalRunningFromPid } from "@/cursor-local/lifecycle/mutex";

export async function GET() {
  try {
    const status = await getCursorLocalStatus();
    return NextResponse.json({
      ...status,
      mutexActive: isCursorLocalRunningFromPid(),
      warning:
        "Unofficial local Cursor backend. May violate Cursor ToS. Restores auth/settings on stop.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e.message || "status failed" },
      { status: 500 },
    );
  }
}
