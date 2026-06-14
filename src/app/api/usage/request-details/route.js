import { NextResponse } from "next/server";
import {
  getRequestDetails,
  getRequestDetailsList,
  getRequestDetailById,
} from "@/lib/usageDb";

/**
 * GET /api/usage/request-details
 * Query parameters: page, pageSize (1-100), provider, model, connectionId, status, startDate, endDate, mode, id
 * mode: "list" (default, metadata only) or "detail" (full data blob, requires id)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const mode = searchParams.get("mode") || "list";
    const id = searchParams.get("id");

    // Detail mode: return full data blob for single record
    if (mode === "detail") {
      if (!id) {
        return NextResponse.json(
          { error: "id required for detail mode" },
          { status: 400 },
        );
      }
      const detail = await getRequestDetailById(id);
      if (!detail) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({ detail });
    }

    // List mode: return metadata only (fast)
    const page = parseInt(searchParams.get("page")) || 1;
    const pageSize = parseInt(searchParams.get("pageSize")) || 20;
    const provider = searchParams.get("provider");
    const model = searchParams.get("model");
    const connectionId = searchParams.get("connectionId");
    const status = searchParams.get("status");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    if (page < 1) {
      return NextResponse.json({ error: "Page must be >= 1" }, { status: 400 });
    }

    if (pageSize < 1 || pageSize > 100) {
      return NextResponse.json(
        { error: "PageSize must be between 1 and 100" },
        { status: 400 },
      );
    }

    const filter = {
      page,
      pageSize,
    };

    if (provider) filter.provider = provider;
    if (model) filter.model = model;
    if (connectionId) filter.connectionId = connectionId;
    if (status) filter.status = status;
    if (startDate) filter.startDate = startDate;
    if (endDate) filter.endDate = endDate;

    const result = await getRequestDetailsList(filter);

    return NextResponse.json(result);
  } catch (error) {
    console.error("[API] Failed to get request details:", error);
    return NextResponse.json(
      { error: "Failed to fetch request details" },
      { status: 500 },
    );
  }
}
