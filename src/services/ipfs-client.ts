/**
 * IPFS Wrapper API Client
 * Handles entity operations via the arke-ipfs-api service binding
 */

export interface Entity {
  id: string;
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
  id: string;
  expect_tip: string;
  components?: Record<string, string>;
  components_remove?: string[];
  children_pi_add?: string[];
  note?: string;
}

export interface AppendVersionResult {
  id: string;
  tip: string;
  ver: number;
}

export class IPFSClient {
  constructor(private fetcher: Fetcher) {}

  /**
   * Download content from IPFS by CID
   */
  async downloadContent(cid: string): Promise<string> {
    const resp = await this.fetcher.fetch(`https://api/cat/${cid}`);
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Failed to download ${cid}: ${resp.status} - ${text}`);
    }
    return resp.text();
  }

  async getEntity(id: string): Promise<Entity> {
    const resp = await this.fetcher.fetch(`https://api/entities/${id}`);
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Failed to get entity ${id}: ${resp.status} - ${text}`);
    }
    const result: any = await resp.json();
    return {
      ...result,
      id: result.id,
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

    const id = result.id;
    const tip = result.tip || result.manifest_cid;

    if (!id) {
      throw new Error(`createEntity returned no ID. Response: ${JSON.stringify(result)}`);
    }

    return {
      id,
      tip,
      ver: result.ver,
      components: request.components,
      children_pi: request.children_pi,
      parent_pi: request.parent_pi,
    };
  }

  async appendVersion(request: AppendVersionRequest): Promise<AppendVersionResult> {
    const resp = await this.fetcher.fetch(`https://api/entities/${request.id}/versions`, {
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
      throw new Error(`Failed to append version to ${request.id}: ${resp.status} - ${text}`);
    }
    const result: any = await resp.json();
    return {
      id: result.id,
      tip: result.tip || result.manifest_cid,
      ver: result.ver,
    };
  }
}
