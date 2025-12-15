/**
 * OrganizerBatchDO - Durable Object for async batch processing
 *
 * State Machine: PROCESSING → PUBLISHING → CALLBACK → DONE
 *
 * For 'organize' operation:
 * 1. PROCESSING: Call LLM to organize files
 * 2. PUBLISHING: Create group entities, update parent entity
 * 3. CALLBACK: Send results to orchestrator
 * 4. DONE: Cleanup
 *
 * For 'strategize' operation:
 * 1. PROCESSING: Call LLM to get strategy
 * 2. (skip PUBLISHING - no entity changes)
 * 3. CALLBACK: Send results to orchestrator
 * 4. DONE: Cleanup
 */

import { DurableObject } from 'cloudflare:workers';
import type {
  Env,
  ProcessRequest,
  OrganizerBatchState,
  PIState,
  StrategizeDOState,
  Phase,
  OrganizerCallbackPayload,
  OrganizeRequest,
  OrganizeResponse,
  StrategizeRequest,
  StrategizeResponse,
} from '../types';
import { IPFSClient } from '../services/ipfs-client';
import { withRetry } from '../lib/retry';
import { processOrganizeRequest } from '../service';
import { processStrategizeRequest } from '../strategize-service';

export class OrganizerBatchDO extends DurableObject<Env> {
  private state: OrganizerBatchState | null = null;
  private ipfsClient: IPFSClient;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ipfsClient = new IPFSClient(env.IPFS_WRAPPER);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/process') {
      return this.handleProcess(request);
    }

    if (url.pathname === '/status') {
      return this.handleStatus();
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  // ─────────────────────────────────────────────────────────────
  // Entry Point: POST /process
  // ─────────────────────────────────────────────────────────────
  private async handleProcess(request: Request): Promise<Response> {
    const body = (await request.json()) as ProcessRequest;

    // Check if already processing
    await this.loadState();
    if (this.state && this.state.phase !== 'DONE' && this.state.phase !== 'ERROR') {
      return Response.json({
        status: 'already_processing',
        chunk_id: this.state.chunk_id,
        phase: this.state.phase,
      });
    }

    const chunkId = `${body.batch_id}:${body.chunk_id}`;
    console.log(`[Organizer:${chunkId}] Starting ${body.operation} operation`);

    // Initialize state based on operation type
    if (body.operation === 'strategize') {
      if (!body.strategize) {
        return Response.json({ error: 'Missing strategize data' }, { status: 400 });
      }

      this.state = {
        batch_id: body.batch_id,
        chunk_id: body.chunk_id,
        r2_prefix: body.r2_prefix,
        operation: 'strategize',
        custom_prompt: body.custom_prompt,
        phase: 'PROCESSING',
        started_at: new Date().toISOString(),
        strategize: {
          status: 'pending',
          retry_count: 0,
          directory_path: body.strategize.directory_path,
          files: body.strategize.files,
          total_file_count: body.strategize.total_file_count,
          chunk_count: body.strategize.chunk_count,
        },
        callback_retry_count: 0,
      };
    } else {
      // organize operation
      if (!body.pis || body.pis.length === 0) {
        return Response.json({ error: 'Missing pis array' }, { status: 400 });
      }

      this.state = {
        batch_id: body.batch_id,
        chunk_id: body.chunk_id,
        r2_prefix: body.r2_prefix,
        operation: 'organize',
        custom_prompt: body.custom_prompt,
        strategy_guidance: body.strategy_guidance,
        phase: 'PROCESSING',
        started_at: new Date().toISOString(),
        pis: body.pis.map((p) => ({
          pi: p.pi,
          current_tip: p.current_tip,
          directory_path: p.directory_path,
          status: 'pending' as const,
          retry_count: 0,
          files: p.files,
          parent_components: p.parent_components,
        })),
        callback_retry_count: 0,
      };

      console.log(`[Organizer:${chunkId}] Initialized with ${body.pis.length} directories`);
    }

    await this.saveState();

    // Schedule immediate processing
    await this.ctx.storage.setAlarm(Date.now() + 100);

    return Response.json({
      status: 'accepted',
      chunk_id: body.chunk_id,
      operation: body.operation,
      total_pis: body.operation === 'organize' ? body.pis?.length : 1,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Alarm Handler: State Machine
  // ─────────────────────────────────────────────────────────────
  async alarm(): Promise<void> {
    await this.loadState();
    if (!this.state) return;

    const chunkId = `${this.state.batch_id}:${this.state.chunk_id}`;

    try {
      switch (this.state.phase) {
        case 'PROCESSING':
          await this.processPhase();
          break;
        case 'PUBLISHING':
          await this.publishPhase();
          break;
        case 'CALLBACK':
          await this.callbackPhase();
          break;
        case 'DONE':
        case 'ERROR':
          await this.cleanup();
          break;
      }
    } catch (error) {
      console.error(`[Organizer:${chunkId}] Alarm error:`, error);
      this.state.global_error = (error as Error).message;
      // Move to callback to report error
      this.state.phase = 'CALLBACK';
      await this.saveState();
      await this.scheduleNextAlarm();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // PROCESSING Phase
  // ─────────────────────────────────────────────────────────────
  private async processPhase(): Promise<void> {
    const chunkId = `${this.state!.batch_id}:${this.state!.chunk_id}`;
    const maxRetries = parseInt(this.env.MAX_RETRIES_PER_PI || '3');

    if (this.state!.operation === 'strategize') {
      await this.processStrategize(chunkId, maxRetries);
    } else {
      await this.processOrganize(chunkId, maxRetries);
    }
  }

  private async processStrategize(chunkId: string, maxRetries: number): Promise<void> {
    const strat = this.state!.strategize!;

    if (strat.status === 'done' || strat.status === 'error') {
      // Move to callback (no publishing for strategize)
      console.log(`[Organizer:${chunkId}] Strategize complete, moving to CALLBACK`);
      this.state!.phase = 'CALLBACK';
      await this.saveState();
      await this.scheduleNextAlarm();
      return;
    }

    console.log(`[Organizer:${chunkId}] Processing strategize for ${strat.directory_path}`);
    strat.status = 'processing';
    await this.saveState();

    try {
      const request: StrategizeRequest = {
        directory_path: strat.directory_path,
        files: strat.files,
        total_file_count: strat.total_file_count,
        chunk_count: strat.chunk_count,
        custom_prompt: this.state!.custom_prompt,
      };

      const result = await processStrategizeRequest(request, this.env);

      strat.status = 'done';
      strat.result = result;
      console.log(`[Organizer:${chunkId}] ✓ Strategize complete: should_coordinate=${result.should_coordinate}`);
    } catch (error) {
      strat.retry_count++;
      const errorMsg = (error as Error).message || 'Unknown error';

      if (strat.retry_count >= maxRetries) {
        strat.status = 'error';
        strat.error = errorMsg;
        console.error(`[Organizer:${chunkId}] ✗ Strategize failed (max retries): ${errorMsg}`);
      } else {
        strat.status = 'pending'; // Will retry
        console.warn(`[Organizer:${chunkId}] ⟳ Strategize retry ${strat.retry_count}/${maxRetries}`);
      }
    }

    await this.saveState();
    await this.scheduleNextAlarm();
  }

  private async processOrganize(chunkId: string, maxRetries: number): Promise<void> {
    const pending = this.state!.pis!.filter((p) => p.status === 'pending');

    if (pending.length === 0) {
      console.log(`[Organizer:${chunkId}] Processing complete, moving to PUBLISHING`);
      this.state!.phase = 'PUBLISHING';
      await this.saveState();
      await this.scheduleNextAlarm();
      return;
    }

    console.log(`[Organizer:${chunkId}] Processing ${pending.length} directories`);

    // Mark as processing
    for (const pi of pending) {
      pi.status = 'processing';
    }
    await this.saveState();

    // Process all in parallel (LLM calls)
    const results = await Promise.allSettled(
      pending.map((pi) => this.processOnePI(pi))
    );

    // Update states based on results
    for (let i = 0; i < pending.length; i++) {
      const pi = pending[i];
      const result = results[i];

      if (result.status === 'fulfilled') {
        pi.status = 'publishing'; // Ready for entity creation
        pi.organize_result = result.value;
        console.log(`[Organizer:${chunkId}] ✓ LLM done for ${pi.directory_path}, groups=${result.value?.groups?.length}`);
      } else {
        pi.retry_count++;
        const errorMsg = result.reason?.message || 'Unknown error';

        if (pi.retry_count >= maxRetries) {
          pi.status = 'error';
          pi.error = errorMsg;
          console.error(`[Organizer:${chunkId}] ✗ ${pi.directory_path} (max retries): ${errorMsg}`);
        } else {
          pi.status = 'pending'; // Will retry
          console.warn(`[Organizer:${chunkId}] ⟳ ${pi.directory_path} retry ${pi.retry_count}/${maxRetries}`);
        }
      }
    }

    await this.saveState();
    await this.scheduleNextAlarm();
  }

  private async processOnePI(pi: PIState): Promise<OrganizeResponse> {
    const request: OrganizeRequest = {
      directory_path: pi.directory_path,
      files: pi.files,
      custom_prompt: this.state!.custom_prompt,
      strategy_guidance: this.state!.strategy_guidance,
    };

    return await processOrganizeRequest(request, this.env);
  }

  // ─────────────────────────────────────────────────────────────
  // PUBLISHING Phase (only for organize operation)
  // ─────────────────────────────────────────────────────────────
  private async publishPhase(): Promise<void> {
    const chunkId = `${this.state!.batch_id}:${this.state!.chunk_id}`;

    // Strategize doesn't need publishing
    if (this.state!.operation === 'strategize') {
      this.state!.phase = 'CALLBACK';
      await this.saveState();
      await this.scheduleNextAlarm();
      return;
    }

    const toPublish = this.state!.pis!.filter(
      (p) => p.status === 'publishing' && p.organize_result && !p.new_parent_tip
    );

    if (toPublish.length === 0) {
      console.log(`[Organizer:${chunkId}] Publishing complete, moving to CALLBACK`);
      this.state!.phase = 'CALLBACK';
      await this.saveState();
      await this.scheduleNextAlarm();
      return;
    }

    console.log(`[Organizer:${chunkId}] Publishing ${toPublish.length} directories`);

    // Process one at a time to avoid overwhelming IPFS
    // (Each directory creates multiple entities)
    const pi = toPublish[0];

    try {
      await this.publishOnePI(pi);
      pi.status = 'done';
      console.log(`[Organizer:${chunkId}] ✓ Published ${pi.directory_path} v${pi.new_parent_version}`);
    } catch (error) {
      pi.status = 'error';
      pi.error = `Publish failed: ${(error as Error).message}`;
      console.error(`[Organizer:${chunkId}] ✗ Publish ${pi.directory_path}: ${pi.error}`);
    }

    await this.saveState();
    await this.scheduleNextAlarm();
  }

  private async publishOnePI(pi: PIState): Promise<void> {
    const response = pi.organize_result!;
    const groups = response.groups;

    // Track created group entities
    pi.group_entities = [];

    // 1. Create new entity for each group
    for (const group of groups) {
      // Build components for this group (reuse existing CIDs from parent)
      const groupComponents: Record<string, string> = {};

      for (const filename of group.files) {
        if (!pi.parent_components[filename]) {
          console.warn(`[Organizer] Component not found: ${filename}`);
          continue;
        }
        groupComponents[filename] = pi.parent_components[filename];
      }

      // Skip if no valid components
      if (Object.keys(groupComponents).length === 0) {
        console.warn(`[Organizer] Skipping empty group: ${group.group_name}`);
        continue;
      }

      // Create new entity with retry for CAS conflicts
      const groupEntity = await withRetry(
        () => this.ipfsClient.createEntity({
          type: 'PI',
          components: groupComponents,
          parent_pi: pi.pi,
          children_pi: [],
          note: `Reorganization group: ${group.group_name}`,
        }),
        { maxRetries: 3, baseDelayMs: 500 }
      );

      pi.group_entities.push({
        group_name: group.group_name,
        pi: groupEntity.pi,
        tip: groupEntity.tip,
        ver: groupEntity.ver,
        files: group.files,
        description: group.description,
      });

      console.log(`[Organizer] Created group ${group.group_name} (PI: ${groupEntity.pi})`);
    }

    // 2. Build list of grouped files to remove from parent
    const groupedFiles = new Set<string>();
    for (const group of groups) {
      for (const filename of group.files) {
        groupedFiles.add(filename);
      }
    }

    // Store ungrouped files
    pi.ungrouped_files = response.ungrouped_files;

    // 3. Upload reorganization description
    const descriptionText = `# Reorganization Summary\n\n${response.reorganization_description}\n\n## Groups Created\n\n${groups
      .map((g) => `- **${g.group_name}**: ${g.description}`)
      .join('\n')}`;

    const descCid = await this.ipfsClient.uploadContent(descriptionText, 'reorganization-description.txt');

    // 4. Build list of components to remove
    const componentsToRemove: string[] = [];
    for (const filename of groupedFiles) {
      if (pi.parent_components[filename]) {
        componentsToRemove.push(filename);
      }
    }

    // 5. Update parent entity with retry for CAS conflicts
    // IMPORTANT: Fetch fresh tip on each retry to handle stale tip bug
    const parentUpdate = await withRetry(
      async () => {
        // Always fetch fresh tip before updating to avoid CAS failures
        const freshEntity = await this.ipfsClient.getEntity(pi.pi);
        const freshTip = freshEntity.tip;

        return this.ipfsClient.appendVersion({
          pi: pi.pi,
          expect_tip: freshTip,
          components: {
            'reorganization-description.txt': descCid,
          },
          components_remove: componentsToRemove,
          note: `Reorganized into ${groups.length} groups`,
        });
      },
      { maxRetries: 3, baseDelayMs: 500 }
    );

    pi.new_parent_tip = parentUpdate.tip;
    pi.new_parent_version = parentUpdate.ver;
  }

  // ─────────────────────────────────────────────────────────────
  // CALLBACK Phase
  // ─────────────────────────────────────────────────────────────
  private async callbackPhase(): Promise<void> {
    const chunkId = `${this.state!.batch_id}:${this.state!.chunk_id}`;
    const maxRetries = parseInt(this.env.MAX_CALLBACK_RETRIES || '3');

    const payload = this.buildCallbackPayload();

    try {
      // Send callback via service binding
      const callbackPath = `/callback/organizer/${this.state!.batch_id}`;
      console.log(`[Organizer:${chunkId}] Sending callback via service binding`);

      const resp = await this.env.ORCHESTRATOR.fetch(
        `https://orchestrator${callbackPath}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      if (!resp.ok) {
        throw new Error(`Callback failed: ${resp.status} ${await resp.text()}`);
      }

      console.log(`[Organizer:${chunkId}] Callback sent: ${payload.summary.succeeded} succeeded, ${payload.summary.failed} failed`);
      this.state!.phase = 'DONE';
      this.state!.completed_at = new Date().toISOString();
      await this.saveState();
      await this.scheduleNextAlarm(); // Will trigger cleanup
    } catch (error) {
      this.state!.callback_retry_count++;

      if (this.state!.callback_retry_count >= maxRetries) {
        console.error(`[Organizer:${chunkId}] Callback failed after ${maxRetries} retries`);
        this.state!.phase = 'DONE'; // Mark done anyway
        this.state!.completed_at = new Date().toISOString();
        await this.saveState();
        await this.scheduleNextAlarm();
      } else {
        console.warn(`[Organizer:${chunkId}] Callback failed, will retry`);
        await this.saveState();
        const delay = 1000 * Math.pow(2, this.state!.callback_retry_count);
        await this.ctx.storage.setAlarm(Date.now() + delay);
      }
    }
  }

  private buildCallbackPayload(): OrganizerCallbackPayload {
    const processingTime = Date.now() - new Date(this.state!.started_at).getTime();

    if (this.state!.operation === 'strategize') {
      const strat = this.state!.strategize!;
      return {
        batch_id: this.state!.batch_id,
        chunk_id: this.state!.chunk_id,
        operation: 'strategize',
        status: strat.status === 'done' ? 'success' : 'error',
        strategize_result: strat.result,
        summary: {
          total: 1,
          succeeded: strat.status === 'done' ? 1 : 0,
          failed: strat.status === 'error' ? 1 : 0,
          processing_time_ms: processingTime,
        },
        error: strat.error || this.state!.global_error,
      };
    }

    // organize operation
    const succeeded = this.state!.pis!.filter((p) => p.status === 'done' && p.new_parent_tip);
    const failed = this.state!.pis!.filter((p) => p.status === 'error');

    return {
      batch_id: this.state!.batch_id,
      chunk_id: this.state!.chunk_id,
      operation: 'organize',
      status: failed.length === 0 ? 'success' : succeeded.length === 0 ? 'error' : 'partial',
      results: this.state!.pis!.map((pi) => ({
        pi: pi.pi,
        status: pi.status === 'done' && pi.new_parent_tip ? 'success' : 'error',
        new_parent_tip: pi.new_parent_tip,
        new_parent_version: pi.new_parent_version,
        group_entities: pi.group_entities,
        ungrouped_files: pi.ungrouped_files,
        reorganization_description: pi.organize_result?.reorganization_description,
        llm_metrics: pi.organize_result ? {
          validation_warnings: pi.organize_result.validation_warnings || [],
          missing_files_count: 0, // Will be filled by orchestrator reconciliation
          missing_files: [],
        } : undefined,
        error: pi.error,
      })),
      summary: {
        total: this.state!.pis!.length,
        succeeded: succeeded.length,
        failed: failed.length,
        processing_time_ms: processingTime,
      },
      error: this.state!.global_error,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────
  private async cleanup(): Promise<void> {
    console.log(`[Organizer] Cleaning up DO storage`);
    await this.ctx.storage.deleteAll();
    this.state = null;
  }

  private async loadState(): Promise<void> {
    this.state = (await this.ctx.storage.get<OrganizerBatchState>('state')) || null;
  }

  private async saveState(): Promise<void> {
    if (this.state) {
      await this.ctx.storage.put('state', this.state);
    }
  }

  private async scheduleNextAlarm(): Promise<void> {
    const delay = parseInt(this.env.ALARM_INTERVAL_MS || '100');
    await this.ctx.storage.setAlarm(Date.now() + delay);
  }

  private async handleStatus(): Promise<Response> {
    await this.loadState();

    if (!this.state) {
      return Response.json({ status: 'not_found' });
    }

    if (this.state.operation === 'strategize') {
      return Response.json({
        status: this.state.phase.toLowerCase(),
        phase: this.state.phase,
        operation: 'strategize',
        strategize_status: this.state.strategize?.status,
      });
    }

    return Response.json({
      status: this.state.phase.toLowerCase(),
      phase: this.state.phase,
      operation: 'organize',
      progress: {
        total: this.state.pis?.length || 0,
        pending: this.state.pis?.filter((p) => p.status === 'pending').length || 0,
        processing: this.state.pis?.filter((p) => p.status === 'processing').length || 0,
        publishing: this.state.pis?.filter((p) => p.status === 'publishing').length || 0,
        done: this.state.pis?.filter((p) => p.status === 'done').length || 0,
        failed: this.state.pis?.filter((p) => p.status === 'error').length || 0,
      },
    });
  }
}
