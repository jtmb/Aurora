/**
 * DEPRECATED: Dev server management is now handled by the Cline CLI orchestrator.
 * The orchestrator manages dev servers as part of task execution.
 * Use POST /api/orchestrator/jobs to run tasks.
 */
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "Dev server API is deprecated. Use /api/orchestrator/jobs to run tasks via Cline CLI orchestrator.",
      migrated: true,
    },
    { status: 410 }
  );
}

export async function GET() {
  return NextResponse.json(
    {
      error: "Dev server API is deprecated. Use /api/orchestrator/jobs to run tasks via Cline CLI orchestrator.",
      migrated: true,
    },
    { status: 410 }
  );
}

export async function DELETE() {
  return NextResponse.json(
    {
      error: "Dev server API is deprecated. Use /api/orchestrator/jobs to run tasks via Cline CLI orchestrator.",
      migrated: true,
    },
    { status: 410 }
  );
}
