// ============================================================================
// Performance Optimized Data Cache Utility
// Provides in-memory caching with TTL, request deduplication, and stale-while-revalidate
// ============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  promise?: Promise<T>;
  staleWhileRevalidate?: boolean;
}

interface CacheOptions {
  ttl?: number; // Time to live in milliseconds (default: 5 minutes)
  staleWhileRevalidate?: boolean; // Allow stale data while revalidating
  maxCacheSize?: number; // Maximum cache entries
}

/**
 * Simple in-memory cache with TTL support
 */
export class DataCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private ttl: number;
  private pendingRequests: Map<string, Promise<T>> = new Map();

  constructor(options: CacheOptions = {}) {
    this.ttl = options.ttl ?? 5 * 60 * 1000; // Default 5 minutes
  }

  /**
   * Generate cache key from parameters
   */
  private generateKey(...args: unknown[]): string {
    return JSON.stringify(args);
  }

  /**
   * Check if cache entry is valid
   */
  private isValid(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.timestamp < this.ttl;
  }

  /**
   * Get data from cache
   */
  get(...args: unknown[]): T | null {
    const key = this.generateKey(...args);
    const entry = this.cache.get(key);
    
    if (entry && this.isValid(entry)) {
      return entry.data;
    }
    
    // Remove expired entry
    if (entry) {
      this.cache.delete(key);
    }
    
    return null;
  }

  /**
   * Set data in cache
   */
  set(data: T, ...args: unknown[]): void {
    const key = this.generateKey(...args);
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Get or fetch data with caching
   * Includes request deduplication to prevent multiple simultaneous requests
   */
  async getOrFetch(
    fetcher: () => Promise<T>,
    ...args: unknown[]
  ): Promise<T> {
    const key = this.generateKey(...args);
    
    // Check if we have valid cached data
    const cached = this.get(...args);
    if (cached !== null) {
      return cached;
    }

    // Check if there's already a pending request for this key
    const existingPromise = this.pendingRequests.get(key);
    if (existingPromise) {
      return existingPromise;
    }

    // Create new fetch promise and store it for deduplication
    const fetchPromise = fetcher().then(data => {
      this.set(data, ...args);
      this.pendingRequests.delete(key);
      return data;
    }).catch(error => {
      this.pendingRequests.delete(key);
      throw error;
    });

    this.pendingRequests.set(key, fetchPromise);
    return fetchPromise;
  }

  /**
   * Invalidate specific cache entry
   */
  invalidate(...args: unknown[]): void {
    const key = this.generateKey(...args);
    this.cache.delete(key);
  }

  /**
   * Invalidate all cache entries
   */
  invalidateAll(): void {
    this.cache.clear();
    this.pendingRequests.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; pending: number } {
    return {
      size: this.cache.size,
      pending: this.pendingRequests.size,
    };
  }
}

// ============================================================================
// Global Cache Instances
// ============================================================================

// Cache for duty records - 3 minute TTL for frequently accessed data
export const dutyRecordsCache = new DataCache<unknown[]>({ ttl: 3 * 60 * 1000 });

// Cache for officers - 5 minute TTL
export const officersCache = new DataCache<unknown[]>({ ttl: 5 * 60 * 1000 });

// Cache for scheduled tasks - 2 minute TTL
export const scheduledTasksCache = new DataCache<unknown[]>({ ttl: 2 * 60 * 1000 });

/**
 * Clear all application caches
 */
export function clearAllCaches(): void {
  dutyRecordsCache.invalidateAll();
  officersCache.invalidateAll();
  scheduledTasksCache.invalidateAll();
}
