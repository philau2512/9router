import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { cursorLocalLogPath } from "@/lib/cursor-local/paths";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const tail = Math.min(
      2000,
      Math.max(1, Number(url.searchParams.get("tail") || 200)),
    );
    const p = cursorLocalLogPath();
    if (!fs.existsSync(p)) {
      return NextResponse.json({ lines: [], path: p });
    }
    const text = fs.readFileSync(p, "utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    return NextResponse.json({
      lines: lines.slice(-tail),
      path: p,
      total: lines.length,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** DELETE /api/cursor-local/logs — truncate log file */
export async function DELETE() {
  try {
    const p = cursorLocalLogPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "");
    return NextResponse.json({ ok: true, path: p, cleared: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
