# Organizer Service Durable Object Implementation Plan

## Overview

This document outlines the plan to migrate the organizer-service from a synchronous worker to the Durable Object (DO) pattern defined in `SERVICE_DO_PATTERN.md`. This enables:

1. **Fan-out parallelism** - Orchestrator spawns many organizer DOs in parallel
2. **Independent processing** - Each DO has its own subrequest budget and rate limiting
3. **Robust error handling** - Retries, backoff, and graceful degradation
4. **Service binding callbacks** - Orchestrator receives completion notifications via internal RPC

## Current Architecture (Synchronous)

```
Orchestrator Batch DO
    │
    │ processReorganizationPhase()
    │   ├── calls callOrganizerService() synchronously
    │   ├── waits for response
    │   ├── creates child entities in IPFS
    │   ├── updates parent entity
    │   └── marks node as reorganization_complete
    │
    ▼
Organizer Worker (stateless)
    │
    ├── POST /organize → LLM call → return groups
    └── POST /strategize → LLM call → return strategy
```

**Problems with current approach:**
- Synchronous blocking ties up orchestrator during LLM calls (10-60s per directory)
- Single subrequest budget limits parallelism
- No automatic retry at DO level
- Orchestrator must manage all entity creation sequentially

## Target Architecture (Async DO Pattern)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Orchestrator Batch DO                             │
│                                                                          │
│  When REORGANIZATION phase begins:                                       │
│  1. Get directories ready for this phase (OCR complete)                  │
│  2. For large dirs: spawn strategize request first                       │
│  3. Build request with files, current_tip, etc.                         │
│  4. POST /process to Organizer DO via service binding                   │
│  5. Mark directories as "organizer_callback_pending"                    │
│  6. Schedule alarm, continue other work                                 │
│                                                                          │
│  On callback received:                                                   │
│  1. Update node state (new child PIs, updated parent tip)               │
│  2. Add new group nodes to state.nodes for downstream phases            │
│  3. Mark reorganization_complete for processed directories              │
│  4. Schedule alarm to continue processing                               │
└─────────────────────────────────────────────────────────────────────────┘
         │
         │ POST /process via service binding
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       Organizer Batch DO                                 │
│                                                                          │
│  State Machine: PROCESSING → PUBLISHING → CALLBACK → DONE               │
│                                                                          │
│  1. PROCESSING: Call LLM (organize or strategize), validate response    │
│  2. PUBLISHING:                                                         │
│     a. Create new child entity for each group                           │
│     b. Upload reorganization-description.txt                            │
│     c. Update parent entity (remove grouped files, add description)     │
│  3. CALLBACK: Send results to orchestrator via service binding          │
│  4. DONE: Cleanup DO storage                                            │
└─────────────────────────────────────────────────────────────────────────┘
         │
         │ POST /callback/organizer/{batch_id} via service binding
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Orchestrator Worker (routing)                        │
│                                                                          │
│  Routes callback to Batch DO's internal handler                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

### Decision 1: DO Handles Entity Creation

The DO will handle not just the LLM call but also all entity operations:
- Creating new child entities for groups
- Updating parent entity to remove grouped files
- Uploading reorganization description

**Rationale:** This keeps entity creation atomic within the DO's retry logic. If creation fails, the entire operation retries. The orchestrator just receives the final state.

### Decision 2: Two Request Types

The DO will handle two types of requests:
1. **`organize`** - Full processing: LLM call + entity creation + parent update
2. **`strategize`** - Strategy only: LLM call, no entity changes

**Rationale:** Strategize is a lightweight operation used before chunking large directories. It doesn't modify entities.

### Decision 3: Chunking Remains in Orchestrator

Large directory chunking (`chunkDirectoryAlphabetically`) stays in the orchestrator because:
- Chunking is purely about splitting node state
- No LLM calls involved
- Modifies multiple state.nodes entries
- Each chunk becomes a separate DO request

The orchestrator calls strategize first, then chunks, then sends each chunk to organize.

### Decision 4: Batch Processing Per Request

Each DO request processes ONE directory (or chunk). The orchestrator spawns multiple DOs in parallel for batch processing.

---

## File Structure (Organizer Service)

```
ai-services/organizer-service/
├── wrangler.jsonc           # Add DO + service bindings
├── src/
│   ├── index.ts             # Worker entry point (keep for /organize, /strategize sync endpoints)
│   ├── types.ts             # Add ProcessRequest, BatchState, PIState, CallbackPayload
│   ├── service.ts           # Keep: LLM organize logic
│   ├── strategize-service.ts # Keep: LLM strategize logic
│   ├── durable-objects/
│   │   └── OrganizerBatchDO.ts   # NEW: Main DO class
│   ├── services/
│   │   └── ipfs-client.ts   # NEW: IPFS wrapper client
│   ├── lib/
│   │   ├── entity-creator.ts    # NEW: Create group entities
│   │   └── retry.ts             # NEW: Retry utility
│   └── utils/               # Keep existing
│       ├── token-utils.ts
│       ├── progressive-tax.ts
│       └── fuzzy-filename-match.ts
```

---

## Implementation Steps

### Phase 1: Service Infrastructure (Organizer Service)

#### Step 1.1: Update wrangler.jsonc

```jsonc
{
  "name": "arke-organizer-service",
  "main": "src/index.ts",
  "compatibility_date": "2024-01-01",

  // Service bindings
  "services": [
    { "binding": "IPFS_WRAPPER", "service": "arke-ipfs-api" },
    { "binding": "ORCHESTRATOR", "service": "arke-orchestrator" }
  ],

  // Durable Object
  "durable_objects": {
    "bindings": [
      { "name": "ORGANIZER_BATCH_DO", "class_name": "OrganizerBatchDO" }
    ]
  },

  "migrations": [
    { "tag": "v1", "new_classes": ["OrganizerBatchDO"] }
  ],

  "vars": {
    "DEEPINFRA_BASE_URL": "https://api.deepinfra.com/v1/openai",
    "MODEL_NAME": "deepseek-ai/DeepSeek-V3-0324",
    "MAX_TOKENS": 163839,
    "TOKEN_BUDGET_PERCENTAGE": 0.3,
    "MAX_RETRIES_PER_PI": "3",
    "MAX_CALLBACK_RETRIES": "3",
    "ALARM_INTERVAL_MS": "100"
  },

  "routes": [
    { "pattern": "organizer.arke.institute", "custom_domain": true }
  ],

  "observability": { "enabled": true }
}
```

#### Step 1.2: Add Types (src/types.ts)

```typescript
// Add to existing types.ts

// Environment bindings (update existing Env)
export interface Env {
  // Existing
  DEEPINFRA_API_KEY: string;
  DEEPINFRA_BASE_URL: string;
  MODEL_NAME: string;
  MAX_TOKENS?: number;
  TOKEN_BUDGET_PERCENTAGE?: number;

  // NEW: Service bindings
  IPFS_WRAPPER: Fetcher;
  ORCHESTRATOR: Fetcher;

  // NEW: DO namespace
  ORGANIZER_BATCH_DO: DurableObjectNamespace;

  // NEW: Config
  MAX_RETRIES_PER_PI?: string;
  MAX_CALLBACK_RETRIES?: string;
  ALARM_INTERVAL_MS?: string;
}

// Request from orchestrator
export interface ProcessRequest {
  batch_id: string;
  chunk_id: string;
  r2_prefix: string;
  operation: 'organize' | 'strategize';
  custom_prompt?: string;
  strategy_guidance?: string;  // For organize: guidance from strategize

  // For organize operation
  pis?: Array<{
    pi: string;
    current_tip: string;
    directory_path: string;
    files: OrganizeFileInput[];
    parent_components: Record<string, string>;  // filename -> CID from parent entity
  }>;

  // For strategize operation
  strategize?: {
    directory_path: string;
    files: OrganizeFileInput[];
    total_file_count: number;
    chunk_count: number;
  };
}

// State machine phases
export type Phase = 'PENDING' | 'PROCESSING' | 'PUBLISHING' | 'CALLBACK' | 'DONE' | 'ERROR';

// Per-PI state tracking
export interface PIState {
  pi: string;
  current_tip: string;
  directory_path: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  retry_count: number;

  // Input
  files: OrganizeFileInput[];
  parent_components: Record<string, string>;

  // LLM result
  organize_result?: OrganizeResponse;

  // Entity results
  group_entities?: Array<{
    group_name: string;
    pi: string;
    tip: string;
    ver: number;
    files: string[];
    description: string;
  }>;

  // Parent update result
  new_parent_tip?: string;
  new_parent_version?: number;
  ungrouped_files?: string[];

  error?: string;
}

// Strategize state (simpler, no entity ops)
export interface StrategizeState {
  status: 'pending' | 'processing' | 'done' | 'error';
  retry_count: number;

  result?: StrategizeResponse;
  error?: string;
}

// DO state
export interface OrganizerBatchState {
  batch_id: string;
  chunk_id: string;
  r2_prefix: string;
  operation: 'organize' | 'strategize';
  custom_prompt?: string;
  strategy_guidance?: string;

  phase: Phase;
  started_at: string;
  completed_at?: string;

  // For organize
  pis?: PIState[];

  // For strategize
  strategize?: StrategizeState;

  callback_retry_count: number;
  global_error?: string;
}

// Callback payload (sent to orchestrator)
export interface OrganizerCallbackPayload {
  batch_id: string;
  chunk_id: string;
  operation: 'organize' | 'strategize';
  status: 'success' | 'partial' | 'error';

  // For organize
  results?: Array<{
    pi: string;
    status: 'success' | 'error';

    // On success
    new_parent_tip?: string;
    new_parent_version?: number;
    group_entities?: Array<{
      group_name: string;
      pi: string;
      tip: string;
      ver: number;
      files: string[];
      description: string;
    }>;
    ungrouped_files?: string[];
    reorganization_description?: string;
    llm_metrics?: {
      validation_warnings?: string[];
      missing_files_count: number;
      missing_files: string[];
    };

    // On error
    error?: string;
  }>;

  // For strategize
  strategize_result?: StrategizeResponse;

  summary: {
    total: number;
    succeeded: number;
    failed: number;
    processing_time_ms: number;
  };

  error?: string;
}
```

#### Step 1.3: Create IPFS Client (src/services/ipfs-client.ts)

```typescript
export interface Entity {
  pi: string;
  tip: string;
  ver: number;
  components: Record<string, string>;
  children_pi?: string[];
  parent_pi?: string;
}

export interface CreateEntityRequest {
  type: string;
  components: Record<string, string>;
  parent_pi?: string;
  children_pi?: string[];
  note?: string;
}

export interface AppendVersionRequest {
  pi: string;
  expect_tip: string;
  components?: Record<string, string>;
  components_remove?: string[];
  children_pi_add?: string[];
  note?: string;
}

export interface AppendVersionResult {
  pi: string;
  tip: string;
  ver: number;
}

export class IPFSClient {
  constructor(private fetcher: Fetcher) {}

  async getEntity(pi: string): Promise<Entity> {
    const resp = await this.fetcher.fetch(`https://api/entities/${pi}`);
    if (!resp.ok) {
      throw new Error(`Failed to get entity ${pi}: ${resp.status}`);
    }
    const result: any = await resp.json();
    return {
      ...result,
      tip: result.tip || result.manifest_cid,
    };
  }

  async uploadContent(content: string, filename: string = 'content.txt'): Promise<string> {
    const formData = new FormData();
    const blob = new Blob([content], { type: 'text/plain' });
    formData.append('file', blob, filename);

    const resp = await this.fetcher.fetch('https://api/upload', {
      method: 'POST',
      body: formData,
    });
    if (!resp.ok) {
      throw new Error(`Failed to upload: ${resp.status}`);
    }
    const data = (await resp.json()) as Array<{ cid: string }>;
    return data[0].cid;
  }

  async createEntity(request: CreateEntityRequest): Promise<Entity> {
    const resp = await this.fetcher.fetch('https://api/entities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Failed to create entity: ${resp.status} - ${text}`);
    }
    const result: any = await resp.json();
    return {
      ...result,
      tip: result.tip || result.manifest_cid,
    };
  }

  async appendVersion(request: AppendVersionRequest): Promise<AppendVersionResult> {
    const resp = await this.fetcher.fetch(`https://api/entities/${request.pi}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expect_tip: request.expect_tip,
        components: request.components,
        components_remove: request.components_remove,
        children_pi_add: request.children_pi_add,
        note: request.note,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Failed to append version: ${resp.status} - ${text}`);
    }
    return resp.json();
  }
}
```

#### Step 1.4: Create Retry Utility (src/lib/retry.ts)

```typescript
export interface RetryOptions {
  maxRetries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxRetries, baseDelayMs = 1000, maxDelayMs = 30000 } = options;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt === maxRetries) break;

      const delay = Math.min(
        maxDelayMs,
        baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 1000
      );
      console.log(`[Retry] Attempt ${attempt}/${maxRetries} failed, retrying in ${Math.round(delay)}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
```

#### Step 1.5: Create OrganizerBatchDO (src/durable-objects/OrganizerBatchDO.ts)

This is the core DO implementation. Key responsibilities:
- Receive process requests from orchestrator
- Call LLM via existing service.ts/strategize-service.ts
- Create group entities via IPFS client
- Update parent entity
- Send callback to orchestrator

See full implementation in the code section below.

#### Step 1.6: Update Worker Entry Point (src/index.ts)

Keep existing sync endpoints for backwards compatibility, add routing to DO for async:

```typescript
import { OrganizerBatchDO } from './durable-objects/OrganizerBatchDO';

export { OrganizerBatchDO };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // NEW: Async DO endpoint
    if (request.method === 'POST' && url.pathname === '/process') {
      const body = await request.json() as ProcessRequest;

      if (!body.batch_id || !body.chunk_id || !body.operation) {
        return Response.json(
          { error: 'Missing required fields: batch_id, chunk_id, operation' },
          { status: 400 }
        );
      }

      const doName = `organizer:${body.batch_id}:${body.chunk_id}`;
      const doId = env.ORGANIZER_BATCH_DO.idFromName(doName);
      const stub = env.ORGANIZER_BATCH_DO.get(doId);

      return stub.fetch(new Request('https://internal/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }));
    }

    // NEW: Status endpoint
    if (request.method === 'GET' && url.pathname.startsWith('/status/')) {
      const parts = url.pathname.split('/');
      const batchId = parts[2];
      const chunkId = parts[3];

      const doName = `organizer:${batchId}:${chunkId}`;
      const doId = env.ORGANIZER_BATCH_DO.idFromName(doName);
      const stub = env.ORGANIZER_BATCH_DO.get(doId);

      return stub.fetch(new Request('https://internal/status'));
    }

    // Existing sync endpoints (keep for backwards compatibility / testing)
    // ... existing /organize, /strategize handling ...
  }
};
```

---

### Phase 2: Orchestrator Integration

#### Step 2.1: Update Orchestrator wrangler.jsonc

No changes needed - `ORGANIZER_SERVICE` binding already exists.

#### Step 2.2: Add Types (orchestrator/src/types.ts)

```typescript
// Add to existing types.ts

// Callback tracking fields on Node
export interface Node {
  // ... existing fields ...

  // Callback tracking for async DO pattern
  organizer_callback_batch?: string;      // Chunk ID sent to organizer DO
  organizer_callback_pending?: boolean;   // True while waiting for callback
  organizer_callback_sent_at?: string;    // ISO timestamp for timeout tracking
}

// Callback payload (received from organizer)
export interface OrganizerCallbackPayload {
  batch_id: string;
  chunk_id: string;
  operation: 'organize' | 'strategize';
  status: 'success' | 'partial' | 'error';

  results?: Array<{
    pi: string;
    status: 'success' | 'error';
    new_parent_tip?: string;
    new_parent_version?: number;
    group_entities?: Array<{
      group_name: string;
      pi: string;
      tip: string;
      ver: number;
      files: string[];
      description: string;
    }>;
    ungrouped_files?: string[];
    reorganization_description?: string;
    llm_metrics?: {
      validation_warnings?: string[];
      missing_files_count: number;
      missing_files: string[];
    };
    error?: string;
  }>;

  strategize_result?: {
    should_coordinate: boolean;
    guidance: string;
    reasoning: string;
  };

  summary: {
    total: number;
    succeeded: number;
    failed: number;
    processing_time_ms: number;
  };

  error?: string;
}
```

#### Step 2.3: Add Callback Routing (orchestrator/src/index.ts)

```typescript
// Add to routing in fetch handler

// Route organizer callbacks to batch DO
if (url.pathname.match(/^\/callback\/organizer\/[^/]+$/) && request.method === 'POST') {
  const batchId = url.pathname.split('/')[3];

  try {
    const doId = env.BATCH_DO.idFromName(batchId);
    const stub = env.BATCH_DO.get(doId);

    const doRequest = new Request('https://do/callback/organizer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: request.body,
    });

    return stub.fetch(doRequest);

  } catch (error: any) {
    return new Response(JSON.stringify({
      error: 'Failed to process callback',
      message: error.message
    }), { status: 500 });
  }
}
```

#### Step 2.4: Add Callback Handler (orchestrator/src/batch-do.ts)

```typescript
// In fetch() method
if (url.pathname === '/callback/organizer' && request.method === 'POST') {
  return this.handleOrganizerCallback(request);
}

// Callback handler method
private async handleOrganizerCallback(request: Request): Promise<Response> {
  const payload = await request.json() as OrganizerCallbackPayload;

  console.log(`[DO] 📥 Received organizer callback for chunk ${payload.chunk_id}`);
  console.log(`[DO]   - Operation: ${payload.operation}`);
  console.log(`[DO]   - Status: ${payload.status}`);

  await this.loadState();

  if (!this.state) {
    return Response.json({ error: 'No batch state found' }, { status: 404 });
  }

  if (payload.operation === 'strategize') {
    // Handle strategize callback - update node with strategy guidance
    return this.handleStrategizeCallback(payload);
  }

  // Handle organize callback
  if (!payload.results) {
    return Response.json({ error: 'Missing results' }, { status: 400 });
  }

  for (const result of payload.results) {
    const node = this.findNodeByPi(result.pi);
    if (!node) {
      console.warn(`[DO] Node not found for PI: ${result.pi}`);
      continue;
    }

    // Clear callback pending flag
    node.organizer_callback_pending = false;

    if (result.status === 'success' && result.new_parent_tip) {
      // Update parent node with new version
      node.current_tip = result.new_parent_tip;
      node.current_version = result.new_parent_version!;

      // Create new nodes for each group entity
      if (result.group_entities) {
        for (const group of result.group_entities) {
          const groupPath = `${node.path}/${sanitizeGroupName(group.group_name)}`.replace('//', '/');

          // Build file arrays for group node
          const groupTextFiles = node.text_files.filter(tf => group.files.includes(tf.filename));
          const groupRefs = node.refs.filter(rf => group.files.includes(rf.filename));

          this.state.nodes[groupPath] = {
            type: 'directory',
            path: groupPath,
            depth: node.depth + 1,
            parent_path: node.path,
            children_paths: [],
            processing_config: node.processing_config,
            pi: group.pi,
            current_tip: group.tip,
            current_version: group.ver,
            text_files: groupTextFiles,
            refs: groupRefs,
            snapshot_published: true,
            ocr_complete: true,
            reorganization_complete: true,  // Don't reorganize groups recursively
            pinax_complete: false,
            entity_ops_complete: false,
            description_complete: false,
            processing_complete: false,
          };

          node.children_paths = [...(node.children_paths || []), groupPath];
          this.state.directories_total++;
        }
      }

      // Update file arrays to keep only ungrouped files
      if (result.ungrouped_files) {
        node.text_files = node.text_files.filter(tf => result.ungrouped_files!.includes(tf.filename));
        node.refs = node.refs.filter(rf => result.ungrouped_files!.includes(rf.filename));
      }

      // Cache reorganization result
      node.reorganization_result = {
        groups: result.group_entities?.map(g => ({
          group_name: g.group_name,
          description: g.description,
          files: g.files,
        })) || [],
        ungrouped_files: result.ungrouped_files || [],
        description: result.reorganization_description || '',
        timestamp: new Date().toISOString(),
        llm_metrics: result.llm_metrics,
      };

      node.reorganization_complete = true;
      this.state.directories_reorganization_complete++;

      console.log(`[DO] ✓ ${node.path} reorganization complete v${result.new_parent_version}`);
    } else {
      // Track error and retry count
      node.phase_errors = node.phase_errors || {};
      node.phase_errors.reorganization = result.error || 'Unknown error';

      node.retry_counts = node.retry_counts || {};
      node.retry_counts.reorganization = (node.retry_counts.reorganization || 0) + 1;

      const maxRetries = this.config?.MAX_DIRECTORY_RETRIES || 3;

      if (node.retry_counts.reorganization >= maxRetries) {
        console.error(`[DO] 🚫 ${node.path} exceeded max retries, SKIPPING`);
        node.reorganization_complete = true;
        this.state.directories_reorganization_complete++;
      }
    }
  }

  this.state.updated_at = new Date().toISOString();
  await this.saveState();

  // Schedule alarm to continue processing
  await this.ctx.storage.setAlarm(Date.now() + 1000);

  return Response.json({ success: true, processed: payload.results.length });
}
```

#### Step 2.5: Update Phase Handler (orchestrator/src/phases/reorganization.ts)

Rewrite to use async DO pattern instead of synchronous calls:

```typescript
export async function processReorganizationPhase(
  state: BatchState,
  env: Env,
  config: Config
): Promise<PhaseResult> {
  // 1. Mark directories with reorganize=false as complete
  const skipped = markSkippedDirectories(state, config);

  // 2. Check for callback timeouts
  const timedOut = checkCallbackTimeouts(state, config);

  // 3. Get directories awaiting callbacks (don't reprocess)
  const awaitingCallback = Object.values(state.nodes).filter(
    n => n.type === 'directory' && n.organizer_callback_pending
  );

  // 4. Get new directories to process (up to batch size)
  const directoriesToProcess = getNextUnprocessedReorgDirectories(state, config, config.BATCH_SIZE_REORGANIZATION);

  // If nothing to process and nothing awaiting, we're done
  if (directoriesToProcess.length === 0 && awaitingCallback.length === 0) {
    return { processed: 0, completed: skipped, remaining: 0, allComplete: true };
  }

  // If awaiting callbacks but nothing new to send, wait
  if (directoriesToProcess.length === 0 && awaitingCallback.length > 0) {
    console.log(`[Reorganization] Waiting for ${awaitingCallback.length} callbacks`);
    return { processed: 0, completed: skipped, remaining: awaitingCallback.length, allComplete: false };
  }

  // 5. Process new directories
  // Handle large directories (need strategize + chunking first)
  const largeDirs = directoriesToProcess.filter(n =>
    (n.text_files.length + n.refs.length) > config.MAX_FILES_FOR_ORGANIZER
  );
  const normalDirs = directoriesToProcess.filter(n =>
    (n.text_files.length + n.refs.length) <= config.MAX_FILES_FOR_ORGANIZER
  );

  // For large directories: call strategize, then chunk
  for (const node of largeDirs) {
    await handleLargeDirectory(node, state, env, config);
  }

  // For normal directories: send batch to organizer DO
  if (normalDirs.length > 0) {
    await sendToOrganizerDO(normalDirs, state, env);
  }

  const remaining = Object.values(state.nodes).filter(
    n => n.type === 'directory' && !n.reorganization_complete && !n.organizer_callback_pending
  ).length;

  return {
    processed: directoriesToProcess.length,
    completed: skipped + largeDirs.length,  // Large dirs are "chunked complete"
    remaining: remaining + awaitingCallback.length + normalDirs.length,
    allComplete: false
  };
}

async function sendToOrganizerDO(
  nodes: Node[],
  state: BatchState,
  env: Env
): Promise<void> {
  const chunkId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const ipfsClient = new IPFSWrapperClient(env.IPFS_WRAPPER);

  // Prepare request with all node data
  const pis = await Promise.all(nodes.map(async (node) => {
    // Gather files (same as current implementation)
    const files = await gatherFilesForOrganize(node, env);

    // Get parent entity to get component CIDs
    const parentEntity = await ipfsClient.getEntity(node.pi!);

    return {
      pi: node.pi!,
      current_tip: node.current_tip!,
      directory_path: node.path,
      files,
      parent_components: parentEntity.components,
    };
  }));

  const request: ProcessRequest = {
    batch_id: state.batch_id,
    chunk_id: chunkId,
    r2_prefix: state.r2_prefix,
    operation: 'organize',
    custom_prompt: buildCustomPrompt(state, 'reorganization'),
    pis,
  };

  // Send to organizer DO
  const response = await env.ORGANIZER_SERVICE.fetch('https://organizer/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Organizer DO error: ${response.status} ${await response.text()}`);
  }

  // Mark directories as pending callback
  const now = new Date().toISOString();
  for (const node of nodes) {
    node.organizer_callback_batch = chunkId;
    node.organizer_callback_pending = true;
    node.organizer_callback_sent_at = now;
  }

  console.log(`[Reorganization] Sent ${nodes.length} directories to organizer DO (chunk: ${chunkId})`);
}
```

---

## Testing Plan

### Unit Tests (Organizer Service)

1. **OrganizerBatchDO state machine**
   - Test PENDING → PROCESSING → PUBLISHING → CALLBACK → DONE transitions
   - Test error handling and retry logic
   - Test callback payload generation

2. **Entity creation logic**
   - Test group entity creation with correct components
   - Test parent entity update with correct removals

### Integration Tests

1. **End-to-end async flow**
   - Orchestrator sends request → DO processes → callback received → state updated

2. **Retry scenarios**
   - LLM failure recovery
   - IPFS failure recovery
   - Callback failure recovery

3. **Large directory handling**
   - Strategize → chunk → process each chunk

### Manual Testing

```bash
# 1. Deploy organizer service
cd ai-services/organizer-service
npm run deploy

# 2. Deploy orchestrator
cd arke-orchestrator
npm run deploy

# 3. Test organizer DO directly
curl -X POST "https://organizer.arke.institute/process" \
  -H "Content-Type: application/json" \
  -d '{
    "batch_id": "test_001",
    "chunk_id": "0",
    "operation": "organize",
    "pis": [{
      "pi": "01ABC...",
      "current_tip": "bafy...",
      "directory_path": "/test",
      "files": [...],
      "parent_components": {...}
    }]
  }'

# 4. Check status
curl "https://organizer.arke.institute/status/test_001/0"

# 5. Test via orchestrator (trigger batch job)
```

---

## Migration Strategy

### Phase 1: Parallel Deployment

1. Deploy organizer DO alongside existing sync endpoints
2. Keep sync `/organize`, `/strategize` working
3. Add async `/process` endpoint

### Phase 2: Orchestrator Migration

1. Add callback handler to orchestrator
2. Update reorganization phase to use async pattern
3. Test thoroughly with small batches

### Phase 3: Full Rollout

1. Remove sync fallback from orchestrator
2. Monitor for issues
3. (Optional) Deprecate sync endpoints in organizer

### Rollback Plan

If issues arise:
1. Revert orchestrator to use sync `callOrganizerService()`
2. Sync endpoints remain functional
3. Investigate and fix DO issues

---

## Appendix: Key Differences from Template Pattern

| Aspect | Template (OCR/Description) | Organizer |
|--------|---------------------------|-----------|
| Entity operations | Append component to existing entity | Create NEW child entities + update parent |
| Request complexity | Simple: pi + tip | Complex: pi + tip + files + parent_components |
| Output per PI | Single new_tip | Multiple group PIs + parent new_tip |
| Chunking | N/A | Large dirs need strategize → chunk first |
| Two operations | No | Yes (organize + strategize) |

---

## Summary

This implementation transforms the organizer-service from a synchronous stateless worker to an async Durable Object pattern that:

1. **Decouples processing** - Organizer DO operates independently with its own retry logic
2. **Enables parallelism** - Multiple DOs can process directories simultaneously
3. **Improves reliability** - Alarm-driven state machine survives restarts
4. **Handles complexity** - Entity creation, parent updates all within DO
5. **Maintains compatibility** - Sync endpoints preserved for testing/fallback
