/**
 * LLM client for calling DeepInfra's OpenAI-compatible API
 * Configured for DeepSeek-V3 with structured output support
 */

import type { Env, LLMResponse, OpenAIRequest, OpenAIResponse, OpenAIUsage, JsonSchema } from './types';

// DeepSeek-V3 pricing (per 1M tokens)
const INPUT_COST_PER_MILLION = 0.38;   // $0.38 per 1M input tokens
const OUTPUT_COST_PER_MILLION = 0.89;  // $0.89 per 1M output tokens

/**
 * Calculate cost in USD based on token usage
 */
function calculateCost(usage: OpenAIUsage): number {
  const inputCost = (usage.prompt_tokens / 1_000_000) * INPUT_COST_PER_MILLION;
  const outputCost = (usage.completion_tokens / 1_000_000) * OUTPUT_COST_PER_MILLION;
  return inputCost + outputCost;
}

/**
 * Call the LLM API with structured output
 *
 * @param systemPrompt - The system prompt (sets role/behavior)
 * @param userPrompt - The user prompt (the actual request)
 * @param env - Environment variables
 * @param jsonSchema - JSON schema for structured output
 * @param temperature - Optional temperature override (0.0-1.0)
 * @returns LLM response with content and metadata
 */
export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  env: Env,
  jsonSchema: JsonSchema,
  temperature?: number
): Promise<LLMResponse> {
  const requestBody: OpenAIRequest = {
    model: env.MODEL_NAME,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: env.MAX_TOKENS || 8192,
    temperature: temperature ?? 0.3,  // Default to 0.3 for consistent output
    response_format: {
      type: 'json_schema',
      json_schema: jsonSchema
    }
  };

  const response = await fetch(`${env.DEEPINFRA_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.DEEPINFRA_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorText}`);
  }

  const data: OpenAIResponse = await response.json();

  if (!data.choices || data.choices.length === 0) {
    throw new Error('LLM API returned no choices');
  }

  const content = data.choices[0].message.content;

  return {
    content,
    tokens: data.usage.total_tokens,
    prompt_tokens: data.usage.prompt_tokens,
    completion_tokens: data.usage.completion_tokens,
    cost_usd: calculateCost(data.usage),
    model: env.MODEL_NAME
  };
}
