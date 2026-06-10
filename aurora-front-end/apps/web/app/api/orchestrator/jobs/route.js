/**
 * api/orchestrator/jobs/route.js — Proxy to code-server orchestrator API
 *
 * POST   /api/orchestrator/jobs     — Start a new orchestrator job
 * GET    /api/orchestrator/jobs     — List all jobs
 */

import { NextResponse } from "next/server";

const API_URL = `${process.env.CODE_SERVER_URL || "http://127.0.0.1:3001"}/api/jobs`;

export async function POST(request) {
  try {
    const body = await request.json();
    const { task, workspaceId, model, provider, mode } = body;

    if (!task || !workspaceId) {
      return NextResponse.json(
        { error: "task and workspaceId are required" },
        { status: 400 }
      );
    }

    const forwardBody = { task, workspaceId };
    if (model) forwardBody.model = model;
    if (provider) forwardBody.provider = provider;
    if (mode) forwardBody.mode = mode;

    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(forwardBody),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error("[orchestrator/jobs] POST error:", err.message);
    return NextResponse.json(
      { error: `Orchestrator unreachable: ${err.message}` },
      { status: 502 }
    );
  }
}

export async function GET() {
  try {
    const res = await fetch(API_URL);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[orchestrator/jobs] GET error:", err.message);
    return NextResponse.json(
      { error: `Orchestrator unreachable: ${err.message}` },
      { status: 502 }
    );
  }
}
