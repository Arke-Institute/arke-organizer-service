/**
 * Strategize service logic
 * Analyzes a sample of files to determine a consistent organization strategy
 */

import type { Env, StrategizeRequest, StrategizeResponse, StrategizeStructuredOutput, JsonSchema } from './types';
import { callLLM } from './llm';
import { generateStrategizeSystemPrompt, generateStrategizeUserPrompt, getLastStrategizeTruncationStats } from './strategize-prompts';
import { validateStrategizeRequest } from './validation';

/**
 * JSON Schema for structured output
 * Guarantees the LLM returns valid JSON in the expected format
 */
const STRATEGIZE_SCHEMA: JsonSchema = {
  name: 'strategize_response',
  schema: {
    type: 'object',
    properties: {
      should_coordinate: {
        type: 'boolean',
        description: 'Whether chunks should follow unified guidance (false if collection is too varied)'
      },
      guidance: {
        type: 'string',
        description: 'Organizational instructions for all chunks to follow, or explanation of why independent is better'
      },
      reasoning: {
        type: 'string',
        description: 'Explanation of the patterns observed in the sample'
      }
    },
    required: ['should_coordinate', 'guidance', 'reasoning'],
    additionalProperties: false
  }
};

/**
 * Main function to process strategize requests
 *
 * Process:
 * 1. Validate input request
 * 2. Generate prompts
 * 3. Call LLM with structured output
 * 4. Parse and return result
 */
export async function processStrategizeRequest(
  request: StrategizeRequest,
  env: Env
): Promise<StrategizeResponse> {
  // 1. Validate input
  validateStrategizeRequest(request);

  // 2. Generate prompts
  const systemPrompt = generateStrategizeSystemPrompt(request.custom_prompt);
  const userPrompt = generateStrategizeUserPrompt(request, env);

  // 3. Call LLM with structured output schema
  const llmResponse = await callLLM(systemPrompt, userPrompt, env, STRATEGIZE_SCHEMA);

  // 4. Parse structured JSON response
  let parsedResponse: StrategizeStructuredOutput;
  try {
    parsedResponse = JSON.parse(llmResponse.content);
  } catch (e) {
    throw new Error('Failed to parse LLM response as JSON: ' + (e instanceof Error ? e.message : String(e)));
  }

  // 5. Get truncation stats
  const truncationStats = getLastStrategizeTruncationStats();

  // 6. Return formatted result (with fallback defaults in case LLM returns null)
  const response: StrategizeResponse = {
    should_coordinate: parsedResponse.should_coordinate ?? false,
    guidance: parsedResponse.guidance || '',
    reasoning: parsedResponse.reasoning || '',
    model: llmResponse.model,
    tokens: {
      prompt: llmResponse.prompt_tokens,
      completion: llmResponse.completion_tokens,
      total: llmResponse.tokens
    },
    cost_usd: llmResponse.cost_usd,
    truncation: truncationStats
  };

  console.log(`[Strategize] should_coordinate=${response.should_coordinate}, guidance="${(response.guidance || '').slice(0, 100)}..."`);

  return response;
}
