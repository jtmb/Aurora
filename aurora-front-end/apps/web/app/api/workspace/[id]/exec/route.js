/**
 * DEPRECATED: Shell command execution is now handled by the Cline CLI orchestrator.
 * Use POST /api/orchestrator/jobs to run tasks with full tool support.
 */
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "Exec API is deprecated. Use /api/orchestrator/jobs to run tasks via Cline CLI orchestrator.",
      migrated: true,
    },
    { status: 410 }
  );
}
