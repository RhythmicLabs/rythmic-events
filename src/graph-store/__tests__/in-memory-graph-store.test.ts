import { describe, it, expect, beforeEach } from '@jest/globals';
import { InMemoryGraphStore } from '../index';

// Plain object shapes (no TS-only syntax for babel compat)
function makeGraph(overrides) {
  return {
    name: 'test-graph',
    companyId: 'company-1',
    userId: 'user-1',
    description: 'A test graph',
    graphType: 'KUBERNETES',
    contextEmbedding: [1, 0, 0],
    nodes: [],
    ...overrides,
  };
}

function makeMicroservice(overrides) {
  return {
    name: 'test-ms',
    companyId: 'company-1',
    userId: 'user-1',
    language: 'typescript',
    framework: 'express',
    ...overrides,
  };
}

describe('InMemoryGraphStore', () => {
  let store;

  beforeEach(async () => {
    store = new InMemoryGraphStore();
    await store.connect();
  });

  // ── Lifecycle ──────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('tracks connected state', async () => {
      expect(store.isConnected()).toBe(true);
      await store.disconnect();
      expect(store.isConnected()).toBe(false);
    });

    it('getStats returns counts', async () => {
      const stats = store.getStats();
      expect(stats.totalGraphs).toBe(0);
      expect(stats.totalMicroservices).toBe(0);
      expect(stats.connected).toBe(true);
    });
  });

  // ── Graph CRUD ─────────────────────────────────────────────────────

  describe('graph CRUD', () => {
    it('createGraph returns an id and getGraph retrieves it', async () => {
      const id = await store.createGraph(makeGraph());
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);

      const graph = await store.getGraph(id);
      expect(graph).not.toBeNull();
      expect(graph.name).toBe('test-graph');
      expect(graph.id).toBe(id);
    });

    it('getGraph returns null for unknown id', async () => {
      expect(await store.getGraph('nonexistent')).toBeNull();
    });

    it('getGraph filters by companyId', async () => {
      const id = await store.createGraph(makeGraph({ companyId: 'c1' }));
      expect(await store.getGraph(id, 'c1')).not.toBeNull();
      expect(await store.getGraph(id, 'c2')).toBeNull();
    });

    it('getGraph filters by userId', async () => {
      const id = await store.createGraph(makeGraph({ userId: 'u1' }));
      expect(await store.getGraph(id, undefined, 'u1')).not.toBeNull();
      expect(await store.getGraph(id, undefined, 'u2')).toBeNull();
    });

    it('getGraphs returns graphs for a company', async () => {
      await store.createGraph(makeGraph({ companyId: 'c1', name: 'g1' }));
      await store.createGraph(makeGraph({ companyId: 'c1', name: 'g2' }));
      await store.createGraph(makeGraph({ companyId: 'c2', name: 'g3' }));

      const c1Graphs = await store.getGraphs('c1');
      expect(c1Graphs).toHaveLength(2);

      const c2Graphs = await store.getGraphs('c2');
      expect(c2Graphs).toHaveLength(1);
    });

    it('getGraphs filters by userId', async () => {
      await store.createGraph(makeGraph({ companyId: 'c1', userId: 'u1', name: 'g1' }));
      await store.createGraph(makeGraph({ companyId: 'c1', userId: 'u2', name: 'g2' }));

      const filtered = await store.getGraphs('c1', 'u1');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('g1');
    });

    it('getGraphs respects limit', async () => {
      await store.createGraph(makeGraph({ companyId: 'c1', name: 'g1' }));
      await store.createGraph(makeGraph({ companyId: 'c1', name: 'g2' }));
      await store.createGraph(makeGraph({ companyId: 'c1', name: 'g3' }));

      const limited = await store.getGraphs('c1', undefined, 2);
      expect(limited).toHaveLength(2);
    });

    it('getGraphByName returns correct graph', async () => {
      await store.createGraph(makeGraph({ companyId: 'c1', name: 'alpha' }));
      await store.createGraph(makeGraph({ companyId: 'c1', name: 'beta' }));

      const graph = await store.getGraphByName('alpha', 'c1');
      expect(graph).not.toBeNull();
      expect(graph.name).toBe('alpha');
    });

    it('getGraphByName returns null for wrong company', async () => {
      await store.createGraph(makeGraph({ companyId: 'c1', name: 'alpha' }));
      expect(await store.getGraphByName('alpha', 'c2')).toBeNull();
    });

    it('updateGraph merges updates', async () => {
      const id = await store.createGraph(makeGraph({ name: 'original' }));
      const updated = await store.updateGraph(id, { description: 'updated desc' });

      expect(updated).not.toBeNull();
      expect(updated.name).toBe('original');
      expect(updated.description).toBe('updated desc');
    });

    it('updateGraph updates name index', async () => {
      const id = await store.createGraph(makeGraph({ companyId: 'c1', name: 'old' }));
      await store.updateGraph(id, { name: 'new' });

      expect(await store.getGraphByName('old', 'c1')).toBeNull();
      expect(await store.getGraphByName('new', 'c1')).not.toBeNull();
    });

    it('updateGraph returns null for unknown id', async () => {
      expect(await store.updateGraph('no-such-id', { name: 'x' })).toBeNull();
    });

    it('deleteGraph removes the graph', async () => {
      const id = await store.createGraph(makeGraph({ companyId: 'c1', name: 'del' }));
      expect(await store.deleteGraph(id)).toBe(true);
      expect(await store.getGraph(id)).toBeNull();
      expect(await store.getGraphByName('del', 'c1')).toBeNull();
      expect(await store.getGraphs('c1')).toHaveLength(0);
    });

    it('deleteGraph returns false for unknown id', async () => {
      expect(await store.deleteGraph('nope')).toBe(false);
    });

    it('upsertGraph creates when not found', async () => {
      const id = await store.upsertGraph(
        makeGraph({ companyId: 'c1', name: 'new-graph' }),
        { name: 'new-graph' },
      );
      expect(typeof id).toBe('string');
      const graph = await store.getGraph(id);
      expect(graph.name).toBe('new-graph');
    });

    it('upsertGraph updates when found by name', async () => {
      const origId = await store.createGraph(
        makeGraph({ companyId: 'c1', name: 'existing' }),
      );
      const upsertedId = await store.upsertGraph(
        makeGraph({ companyId: 'c1', name: 'existing', description: 'updated' }),
        { name: 'existing' },
      );

      expect(upsertedId).toBe(origId);
      const graph = await store.getGraph(origId);
      expect(graph.description).toBe('updated');
    });

    it('upsertGraph updates when found by id', async () => {
      const origId = await store.createGraph(makeGraph({ name: 'by-id' }));
      const upsertedId = await store.upsertGraph(
        makeGraph({ name: 'by-id', description: 'via id' }),
        { id: origId },
      );

      expect(upsertedId).toBe(origId);
      const graph = await store.getGraph(origId);
      expect(graph.description).toBe('via id');
    });
  });

  // ── Microservice CRUD ──────────────────────────────────────────────

  describe('microservice CRUD', () => {
    it('create and get microservice', async () => {
      const id = await store.createMicroservice(makeMicroservice());
      const ms = await store.getMicroservice(id);
      expect(ms).not.toBeNull();
      expect(ms.name).toBe('test-ms');
      expect(ms.id).toBe(id);
    });

    it('getMicroservice returns null for unknown', async () => {
      expect(await store.getMicroservice('no')).toBeNull();
    });

    it('getMicroservices filters by companyId', async () => {
      await store.createMicroservice(makeMicroservice({ companyId: 'c1', name: 'ms1' }));
      await store.createMicroservice(makeMicroservice({ companyId: 'c2', name: 'ms2' }));

      expect(await store.getMicroservices('c1')).toHaveLength(1);
      expect(await store.getMicroservices('c2')).toHaveLength(1);
      expect(await store.getMicroservices('c3')).toHaveLength(0);
    });

    it('getMicroservices respects limit', async () => {
      await store.createMicroservice(makeMicroservice({ companyId: 'c1', name: 'a' }));
      await store.createMicroservice(makeMicroservice({ companyId: 'c1', name: 'b' }));
      await store.createMicroservice(makeMicroservice({ companyId: 'c1', name: 'c' }));

      expect(await store.getMicroservices('c1', 2)).toHaveLength(2);
    });

    it('updateMicroservice merges updates', async () => {
      const id = await store.createMicroservice(makeMicroservice({ name: 'orig' }));
      const updated = await store.updateMicroservice(id, { framework: 'hono' });
      expect(updated.name).toBe('orig');
      expect(updated.framework).toBe('hono');
    });

    it('updateMicroservice returns null for unknown', async () => {
      expect(await store.updateMicroservice('nope', { name: 'x' })).toBeNull();
    });

    it('deleteMicroservice removes it', async () => {
      const id = await store.createMicroservice(makeMicroservice({ companyId: 'c1' }));
      expect(await store.deleteMicroservice(id)).toBe(true);
      expect(await store.getMicroservice(id)).toBeNull();
      expect(await store.getMicroservices('c1')).toHaveLength(0);
    });

    it('deleteMicroservice returns false for unknown', async () => {
      expect(await store.deleteMicroservice('nope')).toBe(false);
    });
  });

  // ── Vector search ──────────────────────────────────────────────────

  describe('searchSimilarGraphsByEmbedding', () => {
    it('returns graphs ranked by similarity', async () => {
      await store.createGraph(makeGraph({
        companyId: 'c1', name: 'close', contextEmbedding: [0.9, 0.1, 0],
      }));
      await store.createGraph(makeGraph({
        companyId: 'c1', name: 'exact', contextEmbedding: [1, 0, 0],
      }));
      await store.createGraph(makeGraph({
        companyId: 'c1', name: 'far', contextEmbedding: [0, 1, 0],
      }));

      const results = await store.searchSimilarGraphsByEmbedding([1, 0, 0], 3, 'c1');
      expect(results).toHaveLength(3);
      expect(results[0].name).toBe('exact');
      expect(results[1].name).toBe('close');
      expect(results[2].name).toBe('far');
    });

    it('respects topK', async () => {
      await store.createGraph(makeGraph({
        companyId: 'c1', name: 'a', contextEmbedding: [1, 0, 0],
      }));
      await store.createGraph(makeGraph({
        companyId: 'c1', name: 'b', contextEmbedding: [0, 1, 0],
      }));

      const results = await store.searchSimilarGraphsByEmbedding([1, 0, 0], 1, 'c1');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('a');
    });

    it('filters by companyId', async () => {
      await store.createGraph(makeGraph({
        companyId: 'c1', name: 'mine', contextEmbedding: [1, 0, 0],
      }));
      await store.createGraph(makeGraph({
        companyId: 'c2', name: 'theirs', contextEmbedding: [1, 0, 0],
      }));

      const results = await store.searchSimilarGraphsByEmbedding([1, 0, 0], 10, 'c1');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('mine');
    });

    it('skips graphs without embeddings', async () => {
      await store.createGraph(makeGraph({
        companyId: 'c1', name: 'no-emb', contextEmbedding: undefined,
      }));
      await store.createGraph(makeGraph({
        companyId: 'c1', name: 'has-emb', contextEmbedding: [1, 0, 0],
      }));

      const results = await store.searchSimilarGraphsByEmbedding([1, 0, 0], 10, 'c1');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('has-emb');
    });

    it('searches all companies when companyId not provided', async () => {
      await store.createGraph(makeGraph({
        companyId: 'c1', name: 'a', contextEmbedding: [1, 0, 0],
      }));
      await store.createGraph(makeGraph({
        companyId: 'c2', name: 'b', contextEmbedding: [0, 1, 0],
      }));

      const results = await store.searchSimilarGraphsByEmbedding([1, 0, 0], 10);
      expect(results).toHaveLength(2);
    });
  });

  // ── LRU eviction ───────────────────────────────────────────────────

  describe('LRU eviction', () => {
    it('evicts least recently used graph when capacity exceeded', async () => {
      const smallStore = new InMemoryGraphStore({ maxGraphs: 2 });
      await smallStore.connect();

      const id1 = await smallStore.createGraph(makeGraph({ companyId: 'c', name: 'g1' }));
      const id2 = await smallStore.createGraph(makeGraph({ companyId: 'c', name: 'g2' }));
      // id1 was accessed first (LRU), adding g3 should evict id1
      await smallStore.createGraph(makeGraph({ companyId: 'c', name: 'g3' }));

      expect(await smallStore.getGraph(id1)).toBeNull();
      expect(await smallStore.getGraph(id2)).not.toBeNull();
      expect(smallStore.getStats().totalGraphs).toBe(2);
    });

    it('evicts least recently used microservice when capacity exceeded', async () => {
      const smallStore = new InMemoryGraphStore({ maxMicroservices: 2 });
      await smallStore.connect();

      const id1 = await smallStore.createMicroservice(makeMicroservice({ companyId: 'c', name: 'ms1' }));
      await smallStore.createMicroservice(makeMicroservice({ companyId: 'c', name: 'ms2' }));
      await smallStore.createMicroservice(makeMicroservice({ companyId: 'c', name: 'ms3' }));

      expect(await smallStore.getMicroservice(id1)).toBeNull();
      expect(smallStore.getStats().totalMicroservices).toBe(2);
    });

    it('accessing a graph refreshes its LRU position', async () => {
      const smallStore = new InMemoryGraphStore({ maxGraphs: 2 });
      await smallStore.connect();

      const id1 = await smallStore.createGraph(makeGraph({ companyId: 'c', name: 'g1' }));
      const id2 = await smallStore.createGraph(makeGraph({ companyId: 'c', name: 'g2' }));

      // Access id1 to refresh it — now id2 is LRU
      await smallStore.getGraph(id1);
      await smallStore.createGraph(makeGraph({ companyId: 'c', name: 'g3' }));

      expect(await smallStore.getGraph(id1)).not.toBeNull();
      expect(await smallStore.getGraph(id2)).toBeNull();
    });
  });

  // ── clear ──────────────────────────────────────────────────────────

  describe('clear', () => {
    it('removes all data', async () => {
      await store.createGraph(makeGraph({ companyId: 'c1', name: 'g1' }));
      await store.createMicroservice(makeMicroservice({ companyId: 'c1', name: 'ms1' }));

      await store.clear();

      expect(store.getStats().totalGraphs).toBe(0);
      expect(store.getStats().totalMicroservices).toBe(0);
      expect(await store.getGraphs('c1')).toHaveLength(0);
      expect(await store.getMicroservices('c1')).toHaveLength(0);
    });
  });
});
