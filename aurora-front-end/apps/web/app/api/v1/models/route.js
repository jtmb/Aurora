// @aurora/api/v1/models - OpenAI-compatible models listing
// Returns available models for the v1 API. Used by Cline and other clients.

import { NextResponse } from 'next/server';

export async function GET() {
  // Return only models that the Aurora gateway can actually route
  // deepseek-chat is the primary model; add more as providers are configured
  return NextResponse.json({
    object: 'list',
    data: [
      {
        id: 'deepseek-v4-pro',
        object: 'model',
        created: 1700000000,
        owned_by: 'deepseek'
      },
      {
        id: 'deepseek-v4-flash',
        object: 'model',
        created: 1700000000,
        owned_by: 'deepseek'
      },
      {
        id: 'qwen2.5-coder-7b',
        object: 'model',
        created: 1700000000,
        owned_by: 'lmstudio'
      },
      {
        id: 'qwen2.5-coder-14b',
        object: 'model',
        created: 1700000000,
        owned_by: 'lmstudio'
      },
      {
        id: 'codestral-22b',
        object: 'model',
        created: 1700000000,
        owned_by: 'lmstudio'
      },
      {
        id: 'deepseek-coder-v2-lite',
        object: 'model',
        created: 1700000000,
        owned_by: 'lmstudio'
      }
    ]
  });
}
