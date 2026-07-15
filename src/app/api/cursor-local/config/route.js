import { NextResponse } from "next/server";
import fs from "fs";
import { cursorLocalConfigPath, cursorLocalRoot } from "@/lib/cursor-local/paths";

function readConfig() {
  try {
    const p = cursorLocalConfigPath();
    if (!fs.existsSync(p)) {
      return {
        backendListenAddr: "127.0.0.1:18090",
        proxyListenAddr: "127.0.0.1:18080",
        routerBaseUrl: "http://127.0.0.1:20128",
        models: [
          {
            displayName: "9Router Default",
            routerModel: "default",
          },
        ],
        restoreAuthOnStop: true,
        restoreSettingsOnStop: true,
      };
    }
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    throw new Error(`config read failed: ${e.message}`);
  }
}

export async function GET() {
  try {
    return NextResponse.json({ config: readConfig(), dataDir: cursorLocalRoot() });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const current = readConfig();
    const next = {
      ...current,
      ...(body.config || body),
    };
    // strip secrets if any
    delete next.injectAuthToken;
    delete next.routerApiKey;
    fs.mkdirSync(cursorLocalRoot(), { recursive: true });
    fs.writeFileSync(
      cursorLocalConfigPath(),
      `${JSON.stringify(next, null, 2)}\n`,
    );
    return NextResponse.json({ ok: true, config: next });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
