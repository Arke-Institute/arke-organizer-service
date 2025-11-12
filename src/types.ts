/**
 * Type definitions for Organizer Service
 * Based on: Organizer Service API Specification
 */

export interface Env {
  DEEPINFRA_API_KEY: string;
  DEEPINFRA_BASE_URL: string;
  MODEL_NAME: string;
  MAX_TOKENS?: number;
  TOKEN_BUDGET_PERCENTAGE?: number;
}

// Request types (from API spec)
export interface OrganizeRequest {
  directory_path: string;
  files: OrganizeFileInput[];
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
