import { describe, it, expect } from '@jest/globals';
import { EventCache } from '../../../cache/index';

describe('Event Cache Tests', () => {
  it('should run basic cache test', () => {
    expect(EventCache).toBeDefined();

    // Test instantiation
    const cache = new EventCache({
      maxSize: 100,
      ttl: 60000,
    });

    expect(cache).toBeDefined();
    expect(typeof cache.add).toBe('function');
    expect(typeof cache.get).toBe('function');
  });
});
