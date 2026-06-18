/**
 * DocumentCache - In-memory performance layer (NO persistence)
 * 
 * Responsibilities:
 * - Cache frequently accessed documents in memory
 * - 1-hour TTL (fixed, not configurable)
 * - Automatic reload from datastore on miss
 * - LRU eviction to manage memory
 * 
 * Design principle: This is ONLY cache, not storage
 */

import { StoredDocument } from './datastore-manager.js';
import { getLogger } from '../utils/logger.js';

interface CacheEntry {
  document: StoredDocument;
  cachedAt: Date;
  lastAccessedAt: Date;
  accessCount: number;
}

export class DocumentCache {
  private cache = new Map<string, CacheEntry>();
  private readonly TTL_MS = 60 * 60 * 1000; // 1 hour (fixed)
  private readonly MAX_SIZE: number;
  private cleanupTimer?: NodeJS.Timeout;
  private logger = getLogger('cache...');
  
  constructor(maxSize: number = 100) {
    this.MAX_SIZE = maxSize;
    this.logger.debug(`DocumentCache initialized with maxSize=${maxSize}, ttl=1h`);
    
    // Start cleanup timer
    this.startCleanupTimer();
  }

  get(id: string): StoredDocument | undefined {
    const entry = this.cache.get(id);
    if (!entry) {
      this.logger.debug(`Cache MISS: ${id}`);
      return undefined;
    }

    // Check TTL
    const age = Date.now() - entry.cachedAt.getTime();
    if (age > this.TTL_MS) {
      this.logger.debug(`Cache EXPIRED: ${id} (age: ${Math.round(age / 60000)}min)`);
      this.cache.delete(id);
      return undefined;
    }

    // Update access stats
    entry.lastAccessedAt = new Date();
    entry.accessCount++;
    
    this.logger.debug(`Cache HIT: ${id} (access count: ${entry.accessCount})`);
    return entry.document;
  }

  set(id: string, document: StoredDocument): void {
    // Evict LRU if cache is full
    if (this.cache.size >= this.MAX_SIZE && !this.cache.has(id)) {
      this.evictLRU();
    }

    this.cache.set(id, {
      document,
      cachedAt: new Date(),
      lastAccessedAt: new Date(),
      accessCount: 1,
    });
    
    this.logger.debug(`Cache SET: ${id} (total cached: ${this.cache.size})`);
  }

  invalidate(id: string): void {
    const existed = this.cache.delete(id);
    if (existed) {
      this.logger.debug(`Cache INVALIDATE: ${id}`);
    }
  }

  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.logger.info(`Cache CLEAR: ${size} documents removed`);
  }

  getStats() {
    const now = Date.now();
    let totalAccesses = 0;
    let expiredCount = 0;
    
    for (const entry of this.cache.values()) {
      totalAccesses += entry.accessCount;
      const age = now - entry.cachedAt.getTime();
      if (age > this.TTL_MS) {
        expiredCount++;
      }
    }
    
    return {
      size: this.cache.size,
      maxSize: this.MAX_SIZE,
      ttlHours: this.TTL_MS / (60 * 60 * 1000),
      totalAccesses,
      expiredCount,
      utilizationPercent: Math.round((this.cache.size / this.MAX_SIZE) * 100),
    };
  }

  private evictLRU(): void {
    let oldestId: string | null = null;
    let oldestTime = Date.now();

    for (const [id, entry] of this.cache) {
      if (entry.lastAccessedAt.getTime() < oldestTime) {
        oldestTime = entry.lastAccessedAt.getTime();
        oldestId = id;
      }
    }

    if (oldestId) {
      this.cache.delete(oldestId);
      this.logger.debug(`Cache EVICT (LRU): ${oldestId}`);
    }
  }

  private startCleanupTimer(): void {
    // Check every 5 minutes for expired entries
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      let cleanedCount = 0;
      
      for (const [id, entry] of this.cache) {
        const age = now - entry.cachedAt.getTime();
        if (age > this.TTL_MS) {
          this.cache.delete(id);
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        this.logger.debug(`Cache cleanup: ${cleanedCount} expired entries removed`);
      }
    }, 5 * 60 * 1000);
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.clear();
    this.logger.debug('DocumentCache destroyed');
  }
}
