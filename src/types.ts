/**
 * Type definitions for Organizer Service
 * Based on: Organizer Service API Specification
 */

export interface Env {
  // LLM API
  DEEPINFRA_API_KEY: string;
  DEEPINFRA_BASE_URL: string;
  MODEL_NAME: string;
  MAX_TOKENS?: number;
  TOKEN_BUDGET_PERCENTAGE?: number;

  // Service bindings
  IPFS_WRAPPER: Fetcher;
  ORCHESTRATOR: Fetcher;

  // DO namespace
  ORGANIZER_BATCH_DO: DurableObjectNamespace;

  // Config
  MAX_RETRIES_PER_PI?: string;
  MAX_CALLBACK_RETRIES?: string;
  ALARM_INTERVAL_MS?: string;
}

// Request types (from API spec)
export interface OrganizeRequest {
  directory_path: string;
  files: OrganizeFileInput[];
  custom_prompt?: string;      // Optional custom instructions for this specific request
  strategy_guidance?: string;  // Optional guidance from strategize phase for consistency across chunks
}

export interface OrganizeFileInput {
  name: string;
  type: 'text' | 'ref';
  content: string;
  original_filename?: string;
  metadata?: {
    mime_type?: string;
    size?: number;
  };
}

// Response types (from API spec)
export interface OrganizeResponse {
  groups: OrganizeGroup[];
  ungrouped_files: string[];
  reorganization_description: string;
  model: string;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  cost_usd?: number;
  truncation?: TruncationMetadata;
  validation_warnings?: string[];
}

// Truncation metadata for observability
export interface TruncationMetadata {
  applied: boolean;
  total_original_tokens: number;
  target_tokens: number;
  deficit: number;
  protection_mode_used: boolean;
  protected_files: number;
  truncated_files: number;
}

export interface OrganizeGroup {
  group_name: string;
  description: string;
  files: string[];
}

// LLM Response structure
export interface LLMResponse {
  content: string;
  tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  model: string;
}

// OpenAI-compatible types
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens: number;
  temperature: number;
  response_format?: {
    type: 'json_schema';
    json_schema: JsonSchema;
  };
}

export interface JsonSchema {
  name: string;
  schema: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties?: boolean;
  };
}

export interface OpenAIUsage {
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
}

export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: OpenAIUsage;
}

// Internal structured output schema for LLM
export interface OrganizeStructuredOutput {
  groups: OrganizeGroup[];
  ungrouped_files: string[];
  reorganization_description: string;
}

// === STRATEGIZE TYPES ===

// Request for strategy analysis
export interface StrategizeRequest {
  directory_path: string;
  files: OrganizeFileInput[];    // Sample files (service handles truncation)
  total_file_count: number;      // Total files in directory
  chunk_count: number;           // How many chunks will be created
  custom_prompt?: string;
}

// Response with strategy guidance
export interface StrategizeResponse {
  should_coordinate: boolean;    // false = let chunks decide independently
  guidance: string;              // Free-form organizational instructions
  reasoning: string;             // Why this approach was chosen
  model: string;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  cost_usd?: number;
  truncation?: TruncationMetadata;
}

// Internal structured output schema for strategize LLM
export interface StrategizeStructuredOutput {
  should_coordinate: boolean;
  guidance: string;
  reasoning: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// DURABLE OBJECT PATTERN TYPES - PI-ONLY Architecture
// ═══════════════════════════════════════════════════════════════════════════
// The orchestrator only sends PIs. We fetch all context from IPFS.
// ═══════════════════════════════════════════════════════════════════════════

// Request from orchestrator to DO (simplified - PI-only)
export interface ProcessRequest {
  batch_id: string;
  chunk_id: string;
  pis: string[];  // Just PI strings - we fetch context from IPFS
  custom_prompt?: string;
}

// State machine phases
export type Phase = 'PENDING' | 'PROCESSING' | 'PUBLISHING' | 'CALLBACK' | 'DONE' | 'ERROR';

// Per-PI state tracking for organize operation
export interface PIState {
  id: string;
  status: 'pending' | 'fetching' | 'processing' | 'publishing' | 'done' | 'error';
  retry_count: number;

  // Context fetched from IPFS (populated during FETCHING phase)
  tip?: string;
  directoryPath?: string;
  files?: OrganizeFileInput[];
  components?: Record<string, string>;  // filename -> CID for group creation

  // LLM result
  organize_result?: OrganizeResponse;

  // Entity results
  group_entities?: Array<{
    group_name: string;
    id: string;
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

// DO state (simplified - no strategize)
export interface OrganizerBatchState {
  batch_id: string;
  chunk_id: string;
  custom_prompt?: string;

  phase: Phase;
  started_at: string;
  completed_at?: string;

  pis: PIState[];

  callback_retry_count: number;
  global_error?: string;
}

// PINode structure for new group entities (matches orchestrator types)
// Note: Callback interface uses 'pi' field name for orchestrator compatibility
export interface PINode {
  pi: string;  // Use 'pi' for orchestrator callback interface
  parent_pi?: string;
  children_pi: string[];
  processing_config: {
    ocr: boolean;
    reorganize?: boolean;
    pinax: boolean;
    cheimarros: boolean;
    describe: boolean;
  };
}

// Callback payload (matches orchestrator's ServiceCallback format)
// Note: Uses 'pi' field for orchestrator compatibility (not 'id')
export interface OrganizerCallbackPayload {
  batch_id: string;
  chunk_id: string;
  status: 'success' | 'partial' | 'error';

  results: Array<{
    pi: string;  // Use 'pi' for orchestrator callback interface
    status: 'success' | 'error';
    new_tip?: string;
    new_version?: number;
    error?: string;

    // Group entities created from this PI
    group_entities?: Array<{
      group_name: string;
      pi: string;  // Use 'pi' for orchestrator callback interface
      files: string[];
      description: string;
    }>;
  }>;

  // New child PIs created during reorganization
  // Orchestrator will add these to its PI tree
  new_pis?: PINode[];

  summary: {
    total: number;
    succeeded: number;
    failed: number;
    processing_time_ms: number;
  };

  error?: string;
}
