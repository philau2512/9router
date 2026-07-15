import { NextResponse } from "next/server";
import { stopCursorLocal, getCursorLocalStatus } from "@/lib/cursor-local/manager";

export async function POST() {
  try {
    const status = await stopCursorLocal();
    return NextResponse.json({ ok: true, status });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e.message || "stop failed",
        status: await getCursorLocalStatus().catch(() => null),
      },
      { status: 500 },
    );
  }
}
