/**
 * Organizer Service
 *
 * LLM-powered file organization service that analyzes directory contents
 * and groups files into logical collections using DeepSeek-V3
 */

import type { Env, OrganizeRequest, StrategizeRequest } from './types';
import { processOrganizeRequest } from './service';
import { processStrategizeRequest } from './strategize-service';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // Only accept POST requests
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed. Use POST.' }),
        {
          status: 405,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    // Route handling
    const url = new URL(request.url);

    // Check for valid endpoints
    if (url.pathname !== '/organize' && url.pathname !== '/strategize') {
      return new Response(
        JSON.stringify({
          error: 'Not found. Available endpoints: POST /organize, POST /strategize'
        }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    try {
      // Parse request body
      let body: OrganizeRequest | StrategizeRequest;
      try {
        body = await request.json();
      } catch (e) {
        return new Response(
          JSON.stringify({ error: 'Invalid JSON in request body' }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          }
        );
      }

      // Check request size (per spec: max 10MB)
      const requestSize = JSON.stringify(body).length;
      const MAX_SIZE = 10 * 1024 * 1024; // 10MB
      if (requestSize > MAX_SIZE) {
        return new Response(
          JSON.stringify({
            error: 'Payload Too Large',
            message: 'Request size exceeds 10MB limit'
          }),
          {
            status: 413,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          }
        );
      }

      // Validate environment variables
      if (!env.DEEPINFRA_API_KEY) {
        throw new Error('DEEPINFRA_API_KEY not configured');
      }
      if (!env.DEEPINFRA_BASE_URL) {
        throw new Error('DEEPINFRA_BASE_URL not configured');
      }
      if (!env.MODEL_NAME) {
        throw new Error('MODEL_NAME not configured');
      }

      // Route to appropriate handler
      let result;
      if (url.pathname === '/strategize') {
        result = await processStrategizeRequest(body as StrategizeRequest, env);
      } else {
        result = await processOrganizeRequest(body as OrganizeRequest, env);
      }

      // Return success response
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });

    } catch (error) {
      // Log error for debugging
      console.error('Error processing request:', error);

      // Determine error status code
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      let statusCode = 500;

      // Return 400 for validation errors
      if (errorMessage.includes('required') ||
          errorMessage.includes('must be') ||
          errorMessage.includes('invalid') ||
          errorMessage.includes('cannot be empty')) {
        statusCode = 400;
      }

      // Return 503 for model availability issues
      if (errorMessage.includes('overloaded') ||
          errorMessage.includes('unavailable') ||
          errorMessage.includes('rate limit')) {
        statusCode = 503;
      }

      return new Response(
        JSON.stringify({
          error: statusCode === 400 ? 'Bad Request' :
                 statusCode === 503 ? 'Service Unavailable' :
                 'Internal Server Error',
          message: errorMessage,
          timestamp: new Date().toISOString()
        }),
        {
          status: statusCode,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }
  }
};
