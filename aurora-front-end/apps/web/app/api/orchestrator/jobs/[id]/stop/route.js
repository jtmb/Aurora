/**
 * api/orchestrator/jobs/[id]/stop/route.js — Stop a running job
 *
 * POST /api/orchestrator/jobs/:id/stop
 */

import { NextResponse } from "next/server";

const BASE_URL = `${process.env.CODE_SERVER_URL || "http://127.0.0.1:3001"}/api/jobs`;

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const res = await fetch(`${BASE_URL}/${id}/stop`, { method: "POST" });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error("[orchestrator/stop] error:", err.message);
    return NextResponse.json(
      { error: `Orchestrator unreachable: ${err.message}` },
      { status: 502 }
    );
  }
}
