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
// DURABLE OBJECT PATTERN TYPES
// ═══════════════════════════════════════════════════════════════════════════

// Request from orchestrator to DO
export interface ProcessRequest {
  batch_id: string;
  chunk_id: string;
  r2_prefix: string;
  operation: 'organize' | 'strategize';
  custom_prompt?: string;
  strategy_guidance?: string;

  // For organize operation
  pis?: Array<{
    pi: string;
    current_tip: string;
    directory_path: string;
    files: OrganizeFileInput[];
    parent_components: Record<string, string>;  // filename -> CID
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

// Per-PI state tracking for organize operation
export interface PIState {
  pi: string;
  current_tip: string;
  directory_path: string;
  status: 'pending' | 'processing' | 'publishing' | 'done' | 'error';
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
export interface StrategizeDOState {
  status: 'pending' | 'processing' | 'done' | 'error';
  retry_count: number;
  directory_path: string;
  files: OrganizeFileInput[];
  total_file_count: number;
  chunk_count: number;

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
  strategize?: StrategizeDOState;

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
