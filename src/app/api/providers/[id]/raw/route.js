import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/models";

// GET /api/providers/[id]/raw - Get raw connection with credentials (for export/backup)
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ connection });
  } catch (error) {
    console.log("Error fetching raw connection:", error);
    return NextResponse.json(
      { error: "Failed to fetch raw connection" },
      { status: 500 },
    );
  }
}