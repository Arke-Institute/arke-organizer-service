/**
 * OrganizerBatchDO - SQLite-backed Durable Object for async batch processing
 *
 * PI-ONLY Architecture: Receives only PIs, fetches all context from IPFS
 *
 * Uses SQLite storage for robustness with large content:
 * - 10GB per DO (vs 128KB per value with KV)
 * - Can store full file contents for complex directories
 * - Files stored in separate rows for efficient access
 *
 * State Machine: PENDING → PROCESSING → PUBLISHING → CALLBACK → DONE
 */

import { DurableObject } from 'cloudflare:workers';
import type {
  Env,
  ProcessRequest,
  PIState,
  Phase,
  OrganizerCallbackPayload,
  OrganizeRequest,
  OrganizeResponse,
  OrganizeFileInput,
  PINode,
} from '../types';
import { IPFSClient } from '../services/ipfs-client';
import { withRetry } from '../lib/retry';
import { processOrganizeRequest } from '../service';
import { fetchOrganizerContext } from '../lib/context-fetcher';

export class OrganizerBatchDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private ipfsClient: IPFSClient;
  private initialized = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.ipfsClient = new IPFSClient(env.IPFS_WRAPPER);
  }

  /**
   * Initialize SQL tables if needed
   */
  private initTables(): void {
    if (this.initialized) return;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS batch_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        batch_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        custom_prompt TEXT,
        phase TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        callback_retry_count INTEGER DEFAULT 0,
        global_error TEXT
      );

      CREATE TABLE IF NOT EXISTS pi_list (
        pi TEXT PRIMARY KEY
      );

      CREATE TABLE IF NOT EXISTS pi_state (
        pi TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER DEFAULT 0,
        tip TEXT,
        directory_path TEXT,
        components_json TEXT,
        new_parent_tip TEXT,
        new_parent_version INTEGER,
        ungrouped_files_json TEXT,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS pi_files (
        pi TEXT NOT NULL,
        idx INTEGER NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        original_filename TEXT,
        metadata_json TEXT,
        PRIMARY KEY (pi, idx)
      );

      CREATE TABLE IF NOT EXISTS pi_organize_result (
        pi TEXT PRIMARY KEY,
        result_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pi_group_entities (
        pi TEXT NOT NULL,
        idx INTEGER NOT NULL,
        group_name TEXT NOT NULL,
        group_pi TEXT NOT NULL,
        tip TEXT NOT NULL,
        ver INTEGER NOT NULL,
        files_json TEXT NOT NULL,
        description TEXT NOT NULL,
        PRIMARY KEY (pi, idx)
      );
    `);

    this.initialized = true;
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
    this.initTables();
    const body = (await request.json()) as ProcessRequest;

    // Check if already processing
    const existingRows = [...this.sql.exec('SELECT phase FROM batch_state WHERE id = 1')];
    if (existingRows.length > 0) {
      const phase = existingRows[0].phase as Phase;
      if (phase !== 'DONE' && phase !== 'ERROR') {
        return Response.json({
          status: 'already_processing',
          chunk_id: body.chunk_id,
          phase,
        });
      }
      // Clear old state for reprocessing
      this.clearAllTables();
    }

    if (!body.pis || body.pis.length === 0) {
      return Response.json({ error: 'Missing pis array' }, { status: 400 });
    }

    const chunkId = `${body.batch_id}:${body.chunk_id}`;
    console.log(`[Organizer:${chunkId}] Starting with ${body.pis.length} PIs`);

    // Initialize batch state
    this.sql.exec(
      `INSERT INTO batch_state (id, batch_id, chunk_id, custom_prompt, phase, started_at, callback_retry_count)
       VALUES (1, ?, ?, ?, 'PENDING', ?, 0)`,
      body.batch_id,
      body.chunk_id,
      body.custom_prompt || null,
      new Date().toISOString()
    );

    // Initialize PI list and states
    for (const pi of body.pis) {
      this.sql.exec('INSERT INTO pi_list (pi) VALUES (?)', pi);
      this.sql.exec(
        'INSERT INTO pi_state (pi, status, retry_count) VALUES (?, ?, 0)',
        pi,
        'pending'
      );
    }

    // Schedule immediate processing
    await this.ctx.storage.setAlarm(Date.now() + 100);

    return Response.json({
      status: 'accepted',
      chunk_id: body.chunk_id,
      total_pis: body.pis.length,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Status Handler
  // ─────────────────────────────────────────────────────────────
  private async handleStatus(): Promise<Response> {
    this.initTables();

    const stateRows = [...this.sql.exec('SELECT * FROM batch_state WHERE id = 1')];
    if (stateRows.length === 0) {
      return Response.json({ status: 'not_found' });
    }
    const state = stateRows[0];

    // Count statuses
    const countRows = [...this.sql.exec(`
      SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'fetching' THEN 1 ELSE 0 END) as fetching,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'publishing' THEN 1 ELSE 0 END) as publishing,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failed,
        COUNT(*) as total
      FROM pi_state
    `)];
    const counts = countRows[0];

    return Response.json({
      status: (state.phase as string).toLowerCase(),
      phase: state.phase,
      progress: {
        total: counts?.total || 0,
        pending: counts?.pending || 0,
        fetching: counts?.fetching || 0,
        processing: counts?.processing || 0,
        publishing: counts?.publishing || 0,
        done: counts?.done || 0,
        failed: counts?.failed || 0,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Alarm Handler: State Machine
  // ─────────────────────────────────────────────────────────────
  async alarm(): Promise<void> {
    this.initTables();

    const stateRows = [...this.sql.exec('SELECT * FROM batch_state WHERE id = 1')];
    if (stateRows.length === 0) return;
    const state = stateRows[0];

    const chunkId = `${state.batch_id}:${state.chunk_id}`;

    try {
      switch (state.phase as Phase) {
        case 'PENDING':
          // Move to processing phase
          this.sql.exec("UPDATE batch_state SET phase = 'PROCESSING' WHERE id = 1");
          await this.scheduleNextAlarm();
          break;
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
      this.sql.exec(
        "UPDATE batch_state SET phase = 'CALLBACK', global_error = ? WHERE id = 1",
        (error as Error).message
      );
      await this.scheduleNextAlarm();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // PROCESSING Phase - Fetch context and call LLM
  // ─────────────────────────────────────────────────────────────
  private async processPhase(): Promise<void> {
    const stateRows = [...this.sql.exec('SELECT * FROM batch_state WHERE id = 1')];
    const state = stateRows[0];
    const chunkId = `${state.batch_id}:${state.chunk_id}`;
    const maxRetries = parseInt(this.env.MAX_RETRIES_PER_PI || '3');

    // Get pending PIs
    const pendingRows = [...this.sql.exec(
      "SELECT pi FROM pi_state WHERE status IN ('pending', 'fetching')"
    )];

    if (pendingRows.length === 0) {
      console.log(`[Organizer:${chunkId}] Processing complete, moving to PUBLISHING`);
      this.sql.exec("UPDATE batch_state SET phase = 'PUBLISHING' WHERE id = 1");
      await this.scheduleNextAlarm();
      return;
    }

    console.log(`[Organizer:${chunkId}] Processing ${pendingRows.length} PIs`);

    // Process all in parallel
    const results = await Promise.allSettled(
      pendingRows.map((row) => this.processOnePI(row.pi as string, state))
    );

    // Update states based on results
    for (let i = 0; i < pendingRows.length; i++) {
      const pi = pendingRows[i].pi as string;
      const result = results[i];

      if (result.status === 'fulfilled') {
        // Count groups for logging
        const resultRows = [...this.sql.exec(
          'SELECT result_json FROM pi_organize_result WHERE pi = ?', pi
        )];
        const groupCount = resultRows.length > 0
          ? JSON.parse(resultRows[0].result_json as string).groups?.length || 0
          : 0;

        this.sql.exec("UPDATE pi_state SET status = 'publishing' WHERE pi = ?", pi);
        console.log(`[Organizer:${chunkId}] ✓ LLM done for ${pi.slice(-8)}, groups=${groupCount}`);
      } else {
        const errorMsg = result.reason?.message || 'Unknown error';
        const retryRows = [...this.sql.exec('SELECT retry_count FROM pi_state WHERE pi = ?', pi)];
        const currentRetry = (retryRows[0]?.retry_count as number) || 0;
        const newRetry = currentRetry + 1;

        if (newRetry >= maxRetries) {
          this.sql.exec(
            "UPDATE pi_state SET status = 'error', retry_count = ?, error = ? WHERE pi = ?",
            newRetry,
            errorMsg,
            pi
          );
          console.error(`[Organizer:${chunkId}] ✗ ${pi.slice(-8)} (max retries): ${errorMsg}`);
        } else {
          this.sql.exec(
            "UPDATE pi_state SET status = 'pending', retry_count = ? WHERE pi = ?",
            newRetry,
            pi
          );
          console.warn(`[Organizer:${chunkId}] ⟳ ${pi.slice(-8)} retry ${newRetry}/${maxRetries}`);
        }
      }
    }

    await this.scheduleNextAlarm();
  }

  private async processOnePI(pi: string, state: Record<string, SqlStorageValue>): Promise<void> {
    // 1. Fetch context from IPFS
    this.sql.exec("UPDATE pi_state SET status = 'fetching' WHERE pi = ?", pi);
    const context = await fetchOrganizerContext(pi, this.ipfsClient);

    // Store context in SQL
    this.sql.exec(
      `UPDATE pi_state SET tip = ?, directory_path = ?, components_json = ? WHERE pi = ?`,
      context.tip,
      context.directoryPath,
      JSON.stringify(context.components),
      pi
    );

    // Store files separately
    for (let i = 0; i < context.files.length; i++) {
      const file = context.files[i];
      this.sql.exec(
        `INSERT OR REPLACE INTO pi_files (pi, idx, name, type, content, original_filename, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        pi,
        i,
        file.name,
        file.type,
        file.content,
        file.original_filename || null,
        file.metadata ? JSON.stringify(file.metadata) : null
      );
    }

    // 2. Skip if too few files to organize
    if (context.files.length < 3) {
      console.log(`[Organizer] ${pi.slice(-8)} has only ${context.files.length} files, skipping`);
      this.sql.exec("UPDATE pi_state SET status = 'done' WHERE pi = ?", pi);
      // Clear files since we're done
      this.sql.exec('DELETE FROM pi_files WHERE pi = ?', pi);
      return;
    }

    // 3. Call LLM to organize
    this.sql.exec("UPDATE pi_state SET status = 'processing' WHERE pi = ?", pi);
    const request: OrganizeRequest = {
      directory_path: context.directoryPath,
      files: context.files,
      custom_prompt: state.custom_prompt as string | undefined,
    };

    const result = await processOrganizeRequest(request, this.env);

    // Store result
    this.sql.exec(
      'INSERT OR REPLACE INTO pi_organize_result (pi, result_json) VALUES (?, ?)',
      pi,
      JSON.stringify(result)
    );

    // Clear files after processing to save space
    this.sql.exec('DELETE FROM pi_files WHERE pi = ?', pi);
  }

  // ─────────────────────────────────────────────────────────────
  // PUBLISHING Phase - Create entities
  // ─────────────────────────────────────────────────────────────
  private async publishPhase(): Promise<void> {
    const stateRows = [...this.sql.exec('SELECT * FROM batch_state WHERE id = 1')];
    const state = stateRows[0];
    const chunkId = `${state.batch_id}:${state.chunk_id}`;

    // Get PIs that need publishing (have organize_result but no new_parent_tip)
    const toPublish = [...this.sql.exec(`
      SELECT ps.pi, ps.tip, ps.directory_path, ps.components_json, por.result_json
      FROM pi_state ps
      JOIN pi_organize_result por ON ps.pi = por.pi
      WHERE ps.status = 'publishing' AND ps.new_parent_tip IS NULL
    `)];

    if (toPublish.length === 0) {
      console.log(`[Organizer:${chunkId}] Publishing complete, moving to CALLBACK`);
      this.sql.exec("UPDATE batch_state SET phase = 'CALLBACK' WHERE id = 1");
      await this.scheduleNextAlarm();
      return;
    }

    console.log(`[Organizer:${chunkId}] Publishing ${toPublish.length} directories`);

    // Process one at a time to avoid overwhelming IPFS
    const row = toPublish[0];
    const pi = row.pi as string;

    try {
      const components = JSON.parse(row.components_json as string) as Record<string, string>;
      const organizeResult = JSON.parse(row.result_json as string) as OrganizeResponse;

      await this.publishOnePI(pi, row.tip as string, components, organizeResult);

      this.sql.exec("UPDATE pi_state SET status = 'done' WHERE pi = ?", pi);

      // Get new version for logging
      const updatedRows = [...this.sql.exec(
        'SELECT new_parent_version FROM pi_state WHERE pi = ?', pi
      )];
      const newVersion = updatedRows[0]?.new_parent_version;
      console.log(`[Organizer:${chunkId}] ✓ Published ${pi.slice(-8)} v${newVersion}`);
    } catch (error) {
      const errorMsg = `Publish failed: ${(error as Error).message}`;
      this.sql.exec(
        "UPDATE pi_state SET status = 'error', error = ? WHERE pi = ?",
        errorMsg,
        pi
      );
      console.error(`[Organizer:${chunkId}] ✗ Publish ${pi.slice(-8)}: ${errorMsg}`);
    }

    await this.scheduleNextAlarm();
  }

  private async publishOnePI(
    pi: string,
    tip: string,
    components: Record<string, string>,
    organizeResult: OrganizeResponse
  ): Promise<void> {
    const groups = organizeResult.groups;
    let groupIdx = 0;

    // 1. Create new entity for each group
    for (const group of groups) {
      // Build components for this group (reuse existing CIDs from parent)
      const groupComponents: Record<string, string> = {};

      for (const filename of group.files) {
        if (!components[filename]) {
          console.warn(`[Organizer] Component not found: ${filename}`);
          continue;
        }
        groupComponents[filename] = components[filename];
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
          parent_pi: pi,
          children_pi: [],
          note: `Reorganization group: ${group.group_name}`,
        }),
        { maxRetries: 3, baseDelayMs: 500 }
      );

      // Store group entity
      this.sql.exec(
        `INSERT INTO pi_group_entities (pi, idx, group_name, group_pi, tip, ver, files_json, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        pi,
        groupIdx++,
        group.group_name,
        groupEntity.id,
        groupEntity.tip,
        groupEntity.ver,
        JSON.stringify(group.files),
        group.description
      );

      console.log(`[Organizer] Created group ${group.group_name} (PI: ${groupEntity.id})`);
    }

    // 2. Build list of grouped files to remove from parent
    const groupedFiles = new Set<string>();
    for (const group of groups) {
      for (const filename of group.files) {
        groupedFiles.add(filename);
      }
    }

    // Store ungrouped files
    this.sql.exec(
      'UPDATE pi_state SET ungrouped_files_json = ? WHERE pi = ?',
      JSON.stringify(organizeResult.ungrouped_files),
      pi
    );

    // 3. Upload reorganization description
    const descriptionText = `# Reorganization Summary\n\n${organizeResult.reorganization_description}\n\n## Groups Created\n\n${groups
      .map((g) => `- **${g.group_name}**: ${g.description}`)
      .join('\n')}`;

    const descCid = await this.ipfsClient.uploadContent(descriptionText, 'reorganization-description.txt');

    // 4. Build list of components to remove
    const componentsToRemove: string[] = [];
    for (const filename of groupedFiles) {
      if (components[filename]) {
        componentsToRemove.push(filename);
      }
    }

    // 5. Update parent entity with retry for CAS conflicts
    const parentUpdate = await withRetry(
      async () => {
        // Always fetch fresh tip before updating to avoid CAS failures
        const freshEntity = await this.ipfsClient.getEntity(pi);
        const freshTip = freshEntity.tip;

        return this.ipfsClient.appendVersion({
          id: pi,
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

    this.sql.exec(
      'UPDATE pi_state SET new_parent_tip = ?, new_parent_version = ? WHERE pi = ?',
      parentUpdate.tip,
      parentUpdate.ver,
      pi
    );
  }

  // ─────────────────────────────────────────────────────────────
  // CALLBACK Phase
  // ─────────────────────────────────────────────────────────────
  private async callbackPhase(): Promise<void> {
    const stateRows = [...this.sql.exec('SELECT * FROM batch_state WHERE id = 1')];
    const state = stateRows[0];
    const chunkId = `${state.batch_id}:${state.chunk_id}`;
    const maxRetries = parseInt(this.env.MAX_CALLBACK_RETRIES || '3');

    const payload = this.buildCallbackPayload(state);

    try {
      // Send callback via service binding
      const callbackPath = `/callback/organizer/${state.batch_id}`;
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
      this.sql.exec(
        "UPDATE batch_state SET phase = 'DONE', completed_at = ? WHERE id = 1",
        new Date().toISOString()
      );
      await this.scheduleNextAlarm(); // Will trigger cleanup
    } catch (error) {
      const retryCount = ((state.callback_retry_count as number) || 0) + 1;

      if (retryCount >= maxRetries) {
        console.error(`[Organizer:${chunkId}] Callback failed after ${maxRetries} retries`);
        this.sql.exec(
          "UPDATE batch_state SET phase = 'DONE', completed_at = ?, callback_retry_count = ? WHERE id = 1",
          new Date().toISOString(),
          retryCount
        );
        await this.scheduleNextAlarm();
      } else {
        console.warn(`[Organizer:${chunkId}] Callback failed, will retry`);
        this.sql.exec(
          'UPDATE batch_state SET callback_retry_count = ? WHERE id = 1',
          retryCount
        );
        const delay = 1000 * Math.pow(2, retryCount);
        await this.ctx.storage.setAlarm(Date.now() + delay);
      }
    }
  }

  private buildCallbackPayload(state: Record<string, SqlStorageValue>): OrganizerCallbackPayload {
    const processingTime = Date.now() - new Date(state.started_at as string).getTime();

    // Get all PI states
    const piStates = [...this.sql.exec('SELECT * FROM pi_state')];

    const succeeded = piStates.filter((p) => p.status === 'done');
    const failed = piStates.filter((p) => p.status === 'error');

    // Build results with group entities
    const results = piStates.map((pi) => {
      // Get group entities for this PI
      const groupRows = [...this.sql.exec(
        'SELECT group_name, group_pi, files_json, description FROM pi_group_entities WHERE pi = ? ORDER BY idx',
        pi.pi
      )];

      const groupEntities = groupRows.length > 0
        ? groupRows.map((g) => ({
            group_name: g.group_name as string,
            pi: g.group_pi as string,  // Use 'pi' for orchestrator callback
            files: JSON.parse(g.files_json as string) as string[],
            description: g.description as string,
          }))
        : undefined;

      return {
        pi: pi.pi as string,  // Use 'pi' for orchestrator callback
        status: (pi.status === 'done' ? 'success' : 'error') as 'success' | 'error',
        new_tip: pi.new_parent_tip as string | undefined,
        new_version: pi.new_parent_version as number | undefined,
        error: pi.error as string | undefined,
        group_entities: groupEntities,
      };
    });

    // Build new_pis array for all group entities created
    const newPIs: PINode[] = [];
    for (const pi of piStates) {
      const groupRows = [...this.sql.exec(
        'SELECT group_pi FROM pi_group_entities WHERE pi = ?',
        pi.pi
      )];

      for (const g of groupRows) {
        newPIs.push({
          pi: g.group_pi as string,  // Use 'pi' for orchestrator callback
          parent_pi: pi.pi as string,
          children_pi: [],
          processing_config: {
            ocr: false,        // Already done (inherited from parent)
            reorganize: false, // Don't reorganize recursively
            pinax: true,       // Extract metadata
            cheimarros: true,  // Build knowledge graph
            describe: true,    // Generate description
          },
        });
      }
    }

    return {
      batch_id: state.batch_id as string,
      chunk_id: state.chunk_id as string,
      status: failed.length === 0 ? 'success' : succeeded.length === 0 ? 'error' : 'partial',
      results,
      new_pis: newPIs.length > 0 ? newPIs : undefined,
      summary: {
        total: piStates.length,
        succeeded: succeeded.length,
        failed: failed.length,
        processing_time_ms: processingTime,
      },
      error: state.global_error as string | undefined,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────
  private clearAllTables(): void {
    this.sql.exec('DELETE FROM batch_state');
    this.sql.exec('DELETE FROM pi_list');
    this.sql.exec('DELETE FROM pi_state');
    this.sql.exec('DELETE FROM pi_files');
    this.sql.exec('DELETE FROM pi_organize_result');
    this.sql.exec('DELETE FROM pi_group_entities');
  }

  private async cleanup(): Promise<void> {
    const stateRows = [...this.sql.exec('SELECT batch_id, chunk_id FROM batch_state WHERE id = 1')];
    const chunkId = stateRows.length > 0
      ? `${stateRows[0].batch_id}:${stateRows[0].chunk_id}`
      : 'unknown';
    console.log(`[Organizer:${chunkId}] Cleaning up DO storage`);
    this.clearAllTables();
  }

  private async scheduleNextAlarm(): Promise<void> {
    const delay = parseInt(this.env.ALARM_INTERVAL_MS || '100');
    await this.ctx.storage.setAlarm(Date.now() + delay);
  }
}
