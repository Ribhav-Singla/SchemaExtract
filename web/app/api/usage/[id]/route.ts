import { NextRequest, NextResponse } from "next/server";

import { getRunDetails } from "../../../../lib/pipeline-trace";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/usage/[id]">,
) {
  try {
    const { id } = await context.params;
    const details = await getRunDetails(id);

    if (!details) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }
    return NextResponse.json(details);
  } catch (error) {
    console.error("Loading request details failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load request" },
      { status: 500 },
    );
  }
}
