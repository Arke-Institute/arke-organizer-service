/**
 * Main service logic for Organizer Service
 * Orchestrates file organization using DeepSeek-V3
 */

import type { Env, OrganizeRequest, OrganizeResponse, OrganizeStructuredOutput, JsonSchema } from './types';
import { callLLM } from './llm';
import { generateSystemPrompt, generateUserPrompt } from './prompts';
import { validateRequest, validateResponse } from './validation';

/**
 * JSON Schema for structured output
 * Guarantees the LLM returns valid JSON in the expected format
 */
const ORGANIZE_SCHEMA: JsonSchema = {
  name: 'organize_response',
  schema: {
    type: 'object',
    properties: {
      groups: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            group_name: {
              type: 'string',
              description: 'Clear, descriptive name for this group (must be filesystem-safe)'
            },
            description: {
              type: 'string',
              description: 'Why these files belong together'
            },
            files: {
              type: 'array',
              items: {
                type: 'string'
              },
              description: 'Array of filenames in this group'
            }
          },
          required: ['group_name', 'description', 'files'],
          additionalProperties: false
        }
      },
      ungrouped_files: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'Files that do not fit into any logical group'
      },
      reorganization_description: {
        type: 'string',
        description: 'Overall description of the organizational strategy'
      }
    },
    required: ['groups', 'ungrouped_files', 'reorganization_description'],
    additionalProperties: false
  }
};

/**
 * Main function to process organization requests
 *
 * Process:
 * 1. Validate input request
 * 2. Generate prompts
 * 3. Call LLM with structured output
 * 4. Parse and validate LLM response
 * 5. Return formatted result
 */
export async function processOrganizeRequest(
  request: OrganizeRequest,
  env: Env
): Promise<OrganizeResponse> {
  // 1. Validate input
  validateRequest(request);

  // 2. Generate prompts
  const systemPrompt = generateSystemPrompt();
  const userPrompt = generateUserPrompt(request);

  // 3. Call LLM with structured output schema
  const llmResponse = await callLLM(systemPrompt, userPrompt, env, ORGANIZE_SCHEMA);

  // 4. Parse structured JSON response
  let parsedResponse: OrganizeStructuredOutput;
  try {
    parsedResponse = JSON.parse(llmResponse.content);
  } catch (e) {
    throw new Error('Failed to parse LLM response as JSON: ' + (e instanceof Error ? e.message : String(e)));
  }

  // 5. Validate the parsed response
  const requestFileNames = request.files.map(f => f.name);
  validateResponse(parsedResponse, requestFileNames);

  // 6. Return formatted result
  return {
    groups: parsedResponse.groups,
    ungrouped_files: parsedResponse.ungrouped_files,
    reorganization_description: parsedResponse.reorganization_description,
    model: llmResponse.model,
    tokens: {
      prompt: llmResponse.prompt_tokens,
      completion: llmResponse.completion_tokens,
      total: llmResponse.tokens
    },
    cost_usd: llmResponse.cost_usd
  };
}
