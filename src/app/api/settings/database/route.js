import { NextResponse } from "next/server";
import { exportDb, getSettings, importDb } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import {
  verifyDashboardPassword,
  verifyDashboardAuthToken,
} from "@/lib/auth/dashboardSession";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const PASSWORD_HEADER = "x-9r-password";

// CLI token requests are already trusted (local machine); skip password re-auth.
function isCliRequest(request) {
  return Boolean(request.headers.get(CLI_TOKEN_HEADER));
}

export async function GET(request) {
  try {
    const token = request.cookies.get("auth_token")?.value;
    const hasValidSession = await verifyDashboardAuthToken(token);

    if (
      !isCliRequest(request) &&
      !hasValidSession &&
      !(await verifyDashboardPassword(request.headers.get(PASSWORD_HEADER)))
    ) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    const includeUsageAnalytics =
      new URL(request.url).searchParams.get("includeUsageAnalytics") === "true";
    const payload = await exportDb({ includeUsageAnalytics });
    return NextResponse.json(payload);
  } catch (error) {
    console.log("Error exporting database:", error);
    return NextResponse.json(
      { error: "Failed to export database" },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    const token = request.cookies.get("auth_token")?.value;
    const hasValidSession = await verifyDashboardAuthToken(token);

    const {
      password,
      restoreUsageAnalytics = false,
      ...payload
    } = await request.json();
    if (
      !isCliRequest(request) &&
      !hasValidSession &&
      !(await verifyDashboardPassword(password))
    ) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    await importDb(payload, { restoreUsageAnalytics });

    // Ensure proxy settings take effect immediately after a DB import.
    try {
      const settings = await getSettings();
      applyOutboundProxyEnv(settings);
    } catch (err) {
      console.warn(
        "[Settings][DatabaseImport] Failed to re-apply outbound proxy env:",
        err,
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error importing database:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to import database" },
      { status: 400 },
    );
  }
}
