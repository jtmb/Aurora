# Chat / Plan / Agent Mode Separation — Implementation Plan

## Current Architecture

### Three modes, two code paths
```
┌──────────────────────────────────────────────────────────────┐
│  AgentPanel.jsx  sendMessage()                               │
│                                                              │
│  effectiveMode === 'chat'                                    │
│  ├─ /api/v1/chat/completions  (direct SSE, no orchestration) │
│  └─ ✅ No file I/O, no tools, no execution                   │
│                                                              │
│  effectiveMode === 'plan' || 'agent'                         │
│  ├─ orchSendMessage() → orchestrator-client                  │
│  ├─ POST /api/orchestrator/jobs → job-manager                │
│  └─ job-manager spawns task-runner.js                        │
│       ├─ planFirst=true (always)                             │
│       ├─ runClinesPlan() — plan generation phase             │
│       └─ while(true) act loop — ALWAYS executes after plan   │
│                                                              │
│  ❌ Plan mode ALWAYS executes tools after plan phase          │
│  ❌ No real-time plan parsing from stream                    │
└──────────────────────────────────────────────────────────────┘
```

### Existing plan UI components (AgentPanel.jsx)

| Component | Lines | Trigger | Function |
|-----------|-------|---------|----------|
| Progress tracker | ~3206 | `planTodos > 0 && agentMode === 'agent'` | Shows flat task list during Agent execution |
| Plan card inline | ~3364 | `isPlanCard === true` | Indigo-styled plan card with task list |
| Plan result view | ~3429 | `isPlanResult === true` | Summary banner + task list + "Execute Plan" button |
| Auto-gen plan card | ~3488 | Alternative plan card variant | Auto-detected plan display |

### Existing plan parsing (`parsePlanTodos`, line 146)

Parses three formats from COMPLETE text (post-hoc, never during stream):
1. **New format**: `## Summary` + `- [x] task` checkboxes
2. **Old phase format**: `### Phase N: name` + `- [x] task`
3. **Old flat format**: `- [x] task` without sections

Returns: `{ todos: [{ id, text, done, complexity, phase, phaseNum, dependsOn }], summary }`

---

## Requirements

1. **Chat mode**: Conversation only, NO execution ever ✅ (already works)
2. **Plan mode**: Generates plan with tracked todos (VS Code Copilot style), streamed in real-time, NO execution, can transition to Agent
3. **Agent mode**: Full execution with plan tracking, tool access ✅ (works, needs refinement)
4. **Stream text parsing**: Real-time parsing of incoming text to extract todo items as they stream (Copilot-style checkbox rendering)

---

## Implementation Plan

### Phase 1: Add `planOnly` flag to orchestrator (Docker)

**File**: `/opt/aurora/orchestrator/task-runner.js`

**Change**: Support `ORCHESTRATOR_PLAN_ONLY=true` environment variable.

```
Pseudo-diff:

  const planFirst = CONFIG.planFirst;
+ const planOnly = process.env.ORCHESTRATOR_PLAN_ONLY === 'true';

  // After planning phase:
  if (planFirst) {
    await runClinesPlan(state);
  }
+ if (planOnly) {
+   console.log('[orchestrator] Plan-only mode — halting after plan.');
+   await finalize(state);
+   return;
+ }
  // ... act loop continues
```

**Behavior**:
- `planOnly=true` → Run plan phase, output plan text, write state, EXIT (no tools)
- `planOnly=false` (default) → Current behavior: plan then act loop

### Phase 2: Pass `mode` from frontend to job-manager

**File**: `apps/web/app/api/orchestrator/jobs/route.js` (Next.js proxy)

```diff
  const body = await request.json();
- const { task, workspaceId, model, provider } = body;
+ const { task, workspaceId, model, provider, mode } = body;

  const forwardBody = { task, workspaceId };
  if (model) forwardBody.model = model;
  if (provider) forwardBody.provider = provider;
+ if (mode) forwardBody.mode = mode;
```

**File**: `/opt/aurora/orchestrator/job-manager.js` (Docker)

```diff
- export function startJob(task, workspaceId, model, provider) {
+ export function startJob(task, workspaceId, model, provider, mode) {

  const env = {
    ...process.env,
    TASK: task,
    WORKSPACE_DIR: workspaceDir,
    STATE_DIR: dir,
    STOP_FILE: join(dir, "stop"),
    ORCH_MODEL: model || "",
    ORCH_PROVIDER: provider || "",
+   ORCHESTRATOR_PLAN_ONLY: mode === 'plan' ? 'true' : 'false',
  };
```

**File**: `apps/web/lib/orchestrator-client.js` (client SDK)

```diff
- async sendMessage(message, workspaceId, model, provider, { onOutput, ... }) {
+ async sendMessage(message, workspaceId, model, provider, { onOutput, ..., mode }) {

  const body = { task: message, workspaceId };
  if (model) body.model = model;
  if (provider) body.provider = provider;
+ if (mode) body.mode = mode;
```

### Phase 3: Real-time plan parsing during streaming

**File**: `apps/web/app/components/AgentPanel.jsx`

**New function**: `parsePlanTodosIncremental(currentText)` — lightweight, runs on every streamed chunk.

```
parsePlanTodosIncremental(text):
  - Scan for `- [ ]` and `- [x]` patterns
  - Extract task text (everything after `] `)
  - Preserve order; detect duplicates by text
  - Return { todos[], summary, inProgress }
  
  Key properties:
  - O(n) single-pass scan
  - Handles partial lines (stream mid-todo)
  - Only emits completed todos, not fragments
  - `inProgress` flag set when Summary header found but todos not yet started
```

**Integration in `onOutput` callback** (line ~1535 in sendMessage):

```diff
  onOutput: (line) => {
+   // ── Incremental plan parsing ──
+   if (effectiveMode === 'plan') {
+     const incremental = parsePlanTodosIncremental(currentAccumulatedText + line);
+     if (incremental.todos.length > 0) {
+       setPlanTodos(incremental.todos);
+       if (incremental.summary) setPlanSummary(incremental.summary);
+     }
+   }
    // ... existing output handling
  }
```

**Visual behavior during stream**:
- User sees "📋 Generating plan..." header
- As each `- [ ] Task name` streams in, a new checkbox row appears
- Done tasks marked with `- [x]` show as checked
- Summary text appears once `### Summary` section is complete
- Final render matches Copilot's plan view: indigo card with organized task list

### Phase 4: Mode routing in AgentPanel.sendMessage()

**Change**: Plan mode sends `mode: 'plan'` to orchestrator.

```diff
  const effectiveMode = isPlanExecution ? 'agent' : agentModeRef.current;
  
  if (effectiveMode === 'chat') {
    // Direct SSE — no orchestrator (unchanged)
    await sendChatMessage(...);
  } else {
+   const orchMode = effectiveMode === 'plan' ? 'plan' : 'agent';
    const { jobId, abort } = orchClient.sendMessage(content, workspaceId, model, provider, {
      onOutput: ...,
      onComplete: ...,
      onError: ...,
+     mode: orchMode,
    });
  }
```

### Phase 5: Remove "Execute Plan" from Chat mode

**Change**: The "Execute Plan" button (line ~3464) and auto-detected plan cards in Chat mode should NOT offer execution.

```diff
  // Plan result view (line ~3429)
- {isPlanResult && (
+ {isPlanResult && agentMode !== 'chat' && (
    ...
    <button onClick={() => { setAgentMode('agent'); ... }}>
      Execute Plan
    </button>
  )}
```

**For Chat mode**: Plan content is displayed as a **read-only** card — shows the structured plan but no "Execute" button.

### Phase 6: Refine plan UI to match Copilot style

**Target**: VS Code Copilot's plan mode UI:
- Plan card with indigo/dark border
- Progress bar showing N/N tasks when executing
- Checkbox animations on completion
- "Thinking..." → "Generating plan..." → individual todo items appearing

**Changes**:
1. Add `planGenerationPhase` state: `'idle' | 'thinking' | 'generating' | 'complete'`
2. Animate checkbox appearance with CSS transition
3. Show "Plan generated" summary banner with task count
4. "Execute Plan" button with agent mode icon

### Phase 7: Handle plan → agent transition

When user clicks "Execute Plan" from Plan mode:
1. Switch mode to Agent (already works, line 3464)
2. Submit "Continue implementing the plan." (already works)
3. Agent reads PLAN.md from workspace filesystem
4. Agent uses plan todos for progress tracking
5. Progress tracker shows during execution

---

## File Change Summary

| File | Location | Change |
|------|----------|--------|
| `task-runner.js` | Docker `/opt/aurora/orchestrator/` | Add `planOnly` flag support |
| `job-manager.js` | Docker `/opt/aurora/orchestrator/` | Pass `mode` → `ORCHESTRATOR_PLAN_ONLY` env |
| `jobs/route.js` | `apps/web/app/api/orchestrator/jobs/` | Forward `mode` field |
| `orchestrator-client.js` | `apps/web/lib/` | Accept and pass `mode` parameter |
| `AgentPanel.jsx` | `apps/web/app/components/` | Real-time plan parsing, mode routing, UI refinements |

---

## Task Breakdown

- [ ] **T1**: Add `ORCHESTRATOR_PLAN_ONLY` support to `task-runner.js`
  - _Complexity: Low | Depends on: none_
- [ ] **T2**: Add `mode` parameter to `job-manager.js` → env var
  - _Complexity: Low | Depends on: T1_
- [ ] **T3**: Forward `mode` through Next.js proxy `/api/orchestrator/jobs/route.js`
  - _Complexity: Low | Depends on: none_
- [ ] **T4**: Add `mode` parameter to `orchestrator-client.js` sendMessage
  - _Complexity: Low | Depends on: T3_
- [ ] **T5**: Implement `parsePlanTodosIncremental()` for real-time stream parsing
  - _Complexity: Medium | Depends on: none_
- [ ] **T6**: Integrate incremental parsing into `onOutput` callback in `AgentPanel.jsx`
  - _Complexity: Medium | Depends on: T5_
- [ ] **T7**: Route Plan mode → orchestrator with `mode: 'plan'` in `sendMessage()`
  - _Complexity: Low | Depends on: T4, T6_
- [ ] **T8**: Remove "Execute Plan" from Chat mode plan cards
  - _Complexity: Low | Depends on: none_
- [ ] **T9**: Add plan generation phase states and animations (Copilot-style UI)
  - _Complexity: Medium | Depends on: T6, T7_
- [ ] **T10**: Verify Chat mode never executes (read-only plan display)
  - _Complexity: Low | Depends on: T8_
- [ ] **T11**: End-to-end test: Plan mode → plan generated → execute in Agent → complete
  - _Complexity: High | Depends on: T1-T9_

---

## Acceptance Criteria

1. **Plan mode generates plan text with todos tracked like VS Code Copilot** — task checkboxes appear in real-time as they stream in
2. **Plan mode NEVER executes tools or modifies files** — orchestrator exits after plan phase
3. **Chat mode NEVER executes or offers execution** — no "Execute Plan" button, no orchestrator calls
4. **Agent mode executes plans** — reads PLAN.md, tracks progress, runs tools
5. **Stream text is parsed Copilot-style** — incremental checkbox rendering during generation
