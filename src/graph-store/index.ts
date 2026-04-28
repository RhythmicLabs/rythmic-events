/**
 * InMemoryGraphStore — Map-based graph storage with secondary indexes
 * and cosine-similarity vector search.
 *
 * Follows the same patterns as EventCache (LRU eviction, access-order tracking)
 * and mirrors DgraphClient's method signatures so it can serve as a drop-in
 * replacement for lightweight / local deployments.
 */

import { searchTopK } from './vector-search';
import type { GraphStorage, GraphStoreStats } from './graph-storage';
import crypto from 'crypto';

// ── Re-exports ────────────────────────────────────────────────────────
export { type GraphStorage, type GraphStoreStats } from './graph-storage';
export {
  cosineSimilarity,
  searchTopK,
  type SimilarityResult,
} from './vector-search';

// ── Options ───────────────────────────────────────────────────────────

export interface InMemoryGraphStoreOptions {
  /** Maximum number of graphs before LRU eviction (default 10 000) */
  maxGraphs?: number;
  /** Maximum number of microservices before LRU eviction (default 10 000) */
  maxMicroservices?: number;
  /** Custom ID generator (default: crypto.randomUUID) */
  idGenerator?: () => string;
  /**
   * Name of the field that holds the embedding vector on a graph object.
   * Defaults to `"contextEmbedding"`.
   */
  embeddingField?: string;
  /**
   * Name of the field that holds the companyId on stored objects.
   * Defaults to `"companyId"`.
   */
  companyIdField?: string;
  /**
   * Name of the field that holds the userId on stored objects.
   * Defaults to `"userId"`.
   */
  userIdField?: string;
  /**
   * Name of the field that holds the name on stored objects.
   * Defaults to `"name"`.
   */
  nameField?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────

const defaultIdGenerator = (): string => crypto.randomUUID();

export function getField<T>(obj: T, field: string): unknown {
  return (obj as Record<string, unknown>)[field];
}

export function setField<T>(obj: T, field: string, value: unknown): void {
  (obj as Record<string, unknown>)[field] = value;
}

// ── Implementation ────────────────────────────────────────────────────

export class InMemoryGraphStore<TGraph, TMicroservice> implements GraphStorage<
  TGraph,
  TMicroservice
> {
  // Primary storage
  private graphs = new Map<string, TGraph>();
  private microservices = new Map<string, TMicroservice>();

  // LRU access order
  private graphAccessOrder: string[] = [];
  private msAccessOrder: string[] = [];

  // Secondary indexes
  private graphsByCompany = new Map<string, Set<string>>();
  private graphsByName = new Map<string, string>(); // key = "companyId:name"
  private graphsByUser = new Map<string, Set<string>>();
  private msByCompany = new Map<string, Set<string>>();

  // Config
  private readonly maxGraphs: number;
  private readonly maxMicroservices: number;
  private readonly idGenerator: () => string;
  private readonly embeddingField: string;
  private readonly companyIdField: string;
  private readonly userIdField: string;
  private readonly nameField: string;

  private connected = false;

  constructor(options: InMemoryGraphStoreOptions = {}) {
    this.maxGraphs = options.maxGraphs ?? 10_000;
    this.maxMicroservices = options.maxMicroservices ?? 10_000;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
    this.embeddingField = options.embeddingField ?? 'contextEmbedding';
    this.companyIdField = options.companyIdField ?? 'companyId';
    this.userIdField = options.userIdField ?? 'userId';
    this.nameField = options.nameField ?? 'name';
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async clear(): Promise<void> {
    this.graphs.clear();
    this.microservices.clear();
    this.graphAccessOrder = [];
    this.msAccessOrder = [];
    this.graphsByCompany.clear();
    this.graphsByName.clear();
    this.graphsByUser.clear();
    this.msByCompany.clear();
  }

  getStats(): GraphStoreStats {
    return {
      totalGraphs: this.graphs.size,
      totalMicroservices: this.microservices.size,
      connected: this.connected,
    };
  }

  // ── Graph CRUD ────────────────────────────────────────────────────

  async createGraph(graph: Omit<TGraph, 'id'>): Promise<string> {
    const id = this.idGenerator();
    const stored = { ...graph, id } as TGraph;

    this.evictGraphIfNeeded();
    this.graphs.set(id, stored);
    this.updateGraphAccessOrder(id);
    this.indexGraph(id, stored);

    return id;
  }

  async getGraph(
    id: string,
    companyId?: string,
    userId?: string
  ): Promise<TGraph | null> {
    const graph = this.graphs.get(id) ?? null;
    if (!graph) return null;

    if (companyId && getField(graph, this.companyIdField) !== companyId) {
      return null;
    }
    if (userId && getField(graph, this.userIdField) !== userId) {
      return null;
    }

    this.updateGraphAccessOrder(id);
    return graph;
  }

  async getGraphs(
    companyId: string,
    userId?: string,
    limit?: number
  ): Promise<TGraph[]> {
    const ids = this.graphsByCompany.get(companyId);
    if (!ids) return [];

    let results: TGraph[] = [];
    for (const id of ids) {
      const graph = this.graphs.get(id);
      if (!graph) continue;
      if (userId && getField(graph, this.userIdField) !== userId) continue;
      results.push(graph);
    }

    if (limit !== undefined && limit > 0) {
      results = results.slice(0, limit);
    }

    return results;
  }

  async getGraphByName(
    name: string,
    companyId: string,
    userId?: string
  ): Promise<TGraph | null> {
    const key = `${companyId}:${name}`;
    const id = this.graphsByName.get(key);
    if (!id) return null;

    return this.getGraph(id, companyId, userId);
  }

  async updateGraph(
    id: string,
    updates: Partial<TGraph>
  ): Promise<TGraph | null> {
    const existing = this.graphs.get(id);
    if (!existing) return null;

    // Remove old indexes before merging
    this.deindexGraph(id, existing);

    const merged = { ...existing, ...updates, id } as TGraph;
    this.graphs.set(id, merged);
    this.updateGraphAccessOrder(id);
    this.indexGraph(id, merged);

    return merged;
  }

  async deleteGraph(id: string): Promise<boolean> {
    const graph = this.graphs.get(id);
    if (!graph) return false;

    this.deindexGraph(id, graph);
    this.graphs.delete(id);
    this.removeFromArray(this.graphAccessOrder, id);

    return true;
  }

  async upsertGraph(
    graph: Omit<TGraph, 'id'>,
    identifier: { name?: string; id?: string }
  ): Promise<string> {
    let existing: TGraph | null = null;

    if (identifier.id) {
      existing = await this.getGraph(
        identifier.id,
        getField(graph, this.companyIdField) as string | undefined,
        getField(graph, this.userIdField) as string | undefined
      );
    } else if (identifier.name) {
      const companyId = getField(graph, this.companyIdField) as string;
      existing = await this.getGraphByName(
        identifier.name,
        companyId,
        getField(graph, this.userIdField) as string | undefined
      );
    }

    if (existing) {
      const existingId = getField(existing, 'id') as string;
      const updated = await this.updateGraph(
        existingId,
        graph as Partial<TGraph>
      );
      return updated ? (getField(updated, 'id') as string) : existingId;
    }

    return this.createGraph(graph);
  }

  // ── Microservice CRUD ─────────────────────────────────────────────

  async createMicroservice(
    microservice: Omit<TMicroservice, 'id'>
  ): Promise<string> {
    const id = this.idGenerator();
    const stored = { ...microservice, id } as TMicroservice;

    this.evictMsIfNeeded();
    this.microservices.set(id, stored);
    this.updateMsAccessOrder(id);
    this.indexMicroservice(id, stored);

    return id;
  }

  async getMicroservice(id: string): Promise<TMicroservice | null> {
    const ms = this.microservices.get(id) ?? null;
    if (ms) this.updateMsAccessOrder(id);
    return ms;
  }

  async getMicroservices(
    companyId: string,
    limit?: number
  ): Promise<TMicroservice[]> {
    const ids = this.msByCompany.get(companyId);
    if (!ids) return [];

    let results: TMicroservice[] = [];
    for (const id of ids) {
      const ms = this.microservices.get(id);
      if (ms) results.push(ms);
    }

    if (limit !== undefined && limit > 0) {
      results = results.slice(0, limit);
    }

    return results;
  }

  async updateMicroservice(
    id: string,
    updates: Partial<TMicroservice>
  ): Promise<TMicroservice | null> {
    const existing = this.microservices.get(id);
    if (!existing) return null;

    this.deindexMicroservice(id, existing);

    const merged = { ...existing, ...updates, id } as TMicroservice;
    this.microservices.set(id, merged);
    this.updateMsAccessOrder(id);
    this.indexMicroservice(id, merged);

    return merged;
  }

  async deleteMicroservice(id: string): Promise<boolean> {
    const ms = this.microservices.get(id);
    if (!ms) return false;

    this.deindexMicroservice(id, ms);
    this.microservices.delete(id);
    this.removeFromArray(this.msAccessOrder, id);

    return true;
  }

  // ── Vector search ─────────────────────────────────────────────────

  async searchSimilarGraphsByEmbedding(
    embedding: number[],
    topK: number = 5,
    companyId?: string
  ): Promise<TGraph[]> {
    // Determine candidate set
    let candidates: TGraph[];

    if (companyId) {
      const ids = this.graphsByCompany.get(companyId);
      if (!ids || ids.size === 0) return [];
      candidates = [];
      for (const id of ids) {
        const g = this.graphs.get(id);
        if (g) candidates.push(g);
      }
    } else {
      candidates = Array.from(this.graphs.values());
    }

    const results = searchTopK(
      candidates,
      embedding,
      (g) => {
        const emb = getField(g, this.embeddingField);
        return Array.isArray(emb) && emb.length > 0
          ? (emb as number[])
          : undefined;
      },
      topK
    );

    return results.map((r) => r.item);
  }

  // ── Internal: Graph indexing ──────────────────────────────────────

  private indexGraph(id: string, graph: TGraph): void {
    const companyId = getField(graph, this.companyIdField) as
      | string
      | undefined;
    const userId = getField(graph, this.userIdField) as string | undefined;
    const name = getField(graph, this.nameField) as string | undefined;

    if (companyId) {
      let set = this.graphsByCompany.get(companyId);
      if (!set) {
        set = new Set();
        this.graphsByCompany.set(companyId, set);
      }
      set.add(id);

      if (name) {
        this.graphsByName.set(`${companyId}:${name}`, id);
      }
    }

    if (userId) {
      let set = this.graphsByUser.get(userId);
      if (!set) {
        set = new Set();
        this.graphsByUser.set(userId, set);
      }
      set.add(id);
    }
  }

  private deindexGraph(id: string, graph: TGraph): void {
    const companyId = getField(graph, this.companyIdField) as
      | string
      | undefined;
    const userId = getField(graph, this.userIdField) as string | undefined;
    const name = getField(graph, this.nameField) as string | undefined;

    if (companyId) {
      this.graphsByCompany.get(companyId)?.delete(id);
      if (name) {
        this.graphsByName.delete(`${companyId}:${name}`);
      }
    }

    if (userId) {
      this.graphsByUser.get(userId)?.delete(id);
    }
  }

  // ── Internal: Microservice indexing ───────────────────────────────

  private indexMicroservice(id: string, ms: TMicroservice): void {
    const companyId = getField(ms, this.companyIdField) as string | undefined;
    if (companyId) {
      let set = this.msByCompany.get(companyId);
      if (!set) {
        set = new Set();
        this.msByCompany.set(companyId, set);
      }
      set.add(id);
    }
  }

  private deindexMicroservice(id: string, ms: TMicroservice): void {
    const companyId = getField(ms, this.companyIdField) as string | undefined;
    if (companyId) {
      this.msByCompany.get(companyId)?.delete(id);
    }
  }

  // ── Internal: LRU eviction ────────────────────────────────────────

  private evictGraphIfNeeded(): void {
    while (
      this.graphs.size >= this.maxGraphs &&
      this.graphAccessOrder.length > 0
    ) {
      const lruId = this.graphAccessOrder.shift()!;
      const graph = this.graphs.get(lruId);
      if (graph) {
        this.deindexGraph(lruId, graph);
        this.graphs.delete(lruId);
      }
    }
  }

  private evictMsIfNeeded(): void {
    while (
      this.microservices.size >= this.maxMicroservices &&
      this.msAccessOrder.length > 0
    ) {
      const lruId = this.msAccessOrder.shift()!;
      const ms = this.microservices.get(lruId);
      if (ms) {
        this.deindexMicroservice(lruId, ms);
        this.microservices.delete(lruId);
      }
    }
  }

  private updateGraphAccessOrder(id: string): void {
    this.removeFromArray(this.graphAccessOrder, id);
    this.graphAccessOrder.push(id);
  }

  private updateMsAccessOrder(id: string): void {
    this.removeFromArray(this.msAccessOrder, id);
    this.msAccessOrder.push(id);
  }

  private removeFromArray(arr: string[], value: string): void {
    const idx = arr.indexOf(value);
    if (idx > -1) arr.splice(idx, 1);
  }
}
