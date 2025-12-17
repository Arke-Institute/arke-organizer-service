/**
 * Organizer Service
 *
 * LLM-powered file organization service that analyzes directory contents
 * and groups files into logical collections using DeepSeek-V3
 *
 * Endpoints:
 * - POST /organize - Synchronous organize (legacy)
 * - POST /strategize - Synchronous strategize (legacy)
 * - POST /process - Async DO-based processing (new)
 * - GET /status/:batchId/:chunkId - Check DO status (new)
 * - GET /health - Health check
 */

import type { Env, OrganizeRequest, StrategizeRequest, ProcessRequest } from './types';
import { processOrganizeRequest } from './service';
import { processStrategizeRequest } from './strategize-service';
import { OrganizerBatchDO } from './durable-objects/OrganizerBatchDO';

// Export the Durable Object class (SQLite-backed for 10GB storage vs 128KB KV limit)
export { OrganizerBatchDO };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // Health check
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'arke-organizer-service' }, {
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // ASYNC DO ENDPOINTS (New Pattern)
    // ═══════════════════════════════════════════════════════════════

    // POST /process - Start async batch processing (PI-only)
    if (request.method === 'POST' && url.pathname === '/process') {
      try {
        const body = await request.json() as ProcessRequest;

        if (!body.batch_id || !body.chunk_id || !body.pis || body.pis.length === 0) {
          return Response.json(
            { error: 'Missing required fields: batch_id, chunk_id, pis[]' },
            { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } }
          );
        }

        // Get or create DO for this batch chunk
        const doName = `organizer:${body.batch_id}:${body.chunk_id}`;
        const doId = env.ORGANIZER_BATCH_DO.idFromName(doName);
        const stub = env.ORGANIZER_BATCH_DO.get(doId);

        // Forward to DO
        const doRequest = new Request('https://internal/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const resp = await stub.fetch(doRequest);
        const result = await resp.json();

        return Response.json(result, {
          status: resp.status,
          headers: { 'Access-Control-Allow-Origin': '*' }
        });
      } catch (error) {
        console.error('Error in /process:', error);
        return Response.json(
          { error: 'Internal error', message: (error as Error).message },
          { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
        );
      }
    }

    // GET /status/:batchId/:chunkId - Check batch status
    if (request.method === 'GET' && url.pathname.startsWith('/status/')) {
      const parts = url.pathname.split('/');
      if (parts.length < 4) {
        return Response.json(
          { error: 'Invalid path. Use /status/:batchId/:chunkId' },
          { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } }
        );
      }

      const batchId = parts[2];
      const chunkId = parts[3];

      const doName = `organizer:${batchId}:${chunkId}`;
      const doId = env.ORGANIZER_BATCH_DO.idFromName(doName);
      const stub = env.ORGANIZER_BATCH_DO.get(doId);

      const resp = await stub.fetch(new Request('https://internal/status'));
      const result = await resp.json();

      return Response.json(result, {
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // SYNC ENDPOINTS (Legacy - kept for backwards compatibility)
    // ═══════════════════════════════════════════════════════════════

    // Only accept POST requests for sync endpoints
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

    // Check for valid sync endpoints
    if (url.pathname !== '/organize' && url.pathname !== '/strategize') {
      return new Response(
        JSON.stringify({
          error: 'Not found. Available endpoints: POST /organize, POST /strategize, POST /process, GET /status/:batchId/:chunkId'
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
