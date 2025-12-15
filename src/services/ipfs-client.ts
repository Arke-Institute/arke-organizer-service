/**
 * IPFS Wrapper API Client
 * Handles entity operations via the arke-ipfs-api service binding
 */

export interface Entity {
  pi: string;
  tip: string;
  ver: number;
  components: Record<string, string>;
  children_pi?: string[];
  parent_pi?: string;
}

export interface CreateEntityRequest {
  type: string;
  components: Record<string, string>;
  parent_pi?: string;
  children_pi?: string[];
  note?: string;
}

export interface AppendVersionRequest {
  pi: string;
  expect_tip: string;
  components?: Record<string, string>;
  components_remove?: string[];
  children_pi_add?: string[];
  note?: string;
}

export interface AppendVersionResult {
  pi: string;
  tip: string;
  ver: number;
}

export class IPFSClient {
  constructor(private fetcher: Fetcher) {}

  async getEntity(pi: string): Promise<Entity> {
    const resp = await this.fetcher.fetch(`https://api/entities/${pi}`);
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Failed to get entity ${pi}: ${resp.status} - ${text}`);
    }
    const result: any = await resp.json();
    return {
      ...result,
      tip: result.tip || result.manifest_cid,
    };
  }

  async uploadContent(content: string, filename: string = 'content.txt'): Promise<string> {
    const formData = new FormData();
    const blob = new Blob([content], { type: 'text/plain' });
    formData.append('file', blob, filename);

    const resp = await this.fetcher.fetch('https://api/upload', {
      method: 'POST',
      body: formData,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Failed to upload: ${resp.status} - ${text}`);
    }
    const data = (await resp.json()) as Array<{ cid: string }>;
    return data[0].cid;
  }

  async createEntity(request: CreateEntityRequest): Promise<Entity> {
    const resp = await this.fetcher.fetch('https://api/entities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Failed to create entity: ${resp.status} - ${text}`);
    }
    const result: any = await resp.json();
    return {
      pi: result.pi,
      tip: result.tip || result.manifest_cid,
      ver: result.ver,
      components: request.components,
      children_pi: request.children_pi,
      parent_pi: request.parent_pi,
    };
  }

  async appendVersion(request: AppendVersionRequest): Promise<AppendVersionResult> {
    const resp = await this.fetcher.fetch(`https://api/entities/${request.pi}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expect_tip: request.expect_tip,
        components: request.components,
        components_remove: request.components_remove,
        children_pi_add: request.children_pi_add,
        note: request.note,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Failed to append version to ${request.pi}: ${resp.status} - ${text}`);
    }
    const result: any = await resp.json();
    return {
      pi: result.pi,
      tip: result.tip || result.manifest_cid,
      ver: result.ver,
    };
  }
}
