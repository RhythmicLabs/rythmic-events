/**
 * GraphStorage interface — abstract contract for graph persistence backends.
 * Generic over TGraph and TMicroservice so @rhythmiclabs/rhythmic-events stays decoupled
 * from kubegram-core types.  Consumers type-parameterize with their concrete types.
 *
 * Method signatures mirror kuberag's DgraphClient so InMemoryGraphStore
 * is a drop-in replacement.
 */

export interface GraphStoreStats {
  totalGraphs: number;
  totalMicroservices: number;
  connected: boolean;
}

export interface GraphStorage<TGraph, TMicroservice> {
  // ── Graph CRUD ──────────────────────────────────────────────────────

  createGraph(graph: Omit<TGraph, 'id'>): Promise<string>;

  getGraph(
    id: string,
    companyId?: string,
    userId?: string
  ): Promise<TGraph | null>;

  getGraphs(
    companyId: string,
    userId?: string,
    limit?: number
  ): Promise<TGraph[]>;

  getGraphByName(
    name: string,
    companyId: string,
    userId?: string
  ): Promise<TGraph | null>;

  updateGraph(id: string, updates: Partial<TGraph>): Promise<TGraph | null>;

  deleteGraph(id: string): Promise<boolean>;

  upsertGraph(
    graph: Omit<TGraph, 'id'>,
    identifier: { name?: string; id?: string }
  ): Promise<string>;

  // ── Microservice CRUD ───────────────────────────────────────────────

  createMicroservice(microservice: Omit<TMicroservice, 'id'>): Promise<string>;

  getMicroservice(id: string): Promise<TMicroservice | null>;

  getMicroservices(companyId: string, limit?: number): Promise<TMicroservice[]>;

  updateMicroservice(
    id: string,
    updates: Partial<TMicroservice>
  ): Promise<TMicroservice | null>;

  deleteMicroservice(id: string): Promise<boolean>;

  // ── Vector search ───────────────────────────────────────────────────

  searchSimilarGraphsByEmbedding(
    embedding: number[],
    topK?: number,
    companyId?: string
  ): Promise<TGraph[]>;

  // ── Lifecycle ───────────────────────────────────────────────────────

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  clear(): Promise<void>;
  getStats(): GraphStoreStats;
}
