/**
 * api/orchestrator/jobs/[id]/route.js — Get a single job's status
 *
 * GET /api/orchestrator/jobs/:id
 */

import { NextResponse } from "next/server";

const BASE_URL = `${process.env.CODE_SERVER_URL || "http://127.0.0.1:3001"}/api/jobs`;

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const res = await fetch(`${BASE_URL}/${id}`);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: data.error || "Job not found" },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[orchestrator/jobs/:id] GET error:", err.message);
    return NextResponse.json(
      { error: `Orchestrator unreachable: ${err.message}` },
      { status: 502 }
    );
  }
}
