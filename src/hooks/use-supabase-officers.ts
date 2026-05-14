// ============================================================================
// Supabase Officers Hook — Egress-Optimized
// Changes vs original:
//   1. select('*') → select only needed columns
//   2. Removed Postgres realtime subscription (biggest egress source)
//   3. Initial load served from localStorage backup when fresh (<5 min old)
//   4. insert/update .select() scoped to needed columns only
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { Officer, OfficerInsert, OfficerUpdate } from '../types/database';

// ============================================================================
// Types
// ============================================================================

interface SearchResultOfficer {
  id: string;
  name: string;
  rank: string;
  badge_number: string | null;
  unit: string;
  current_status: 'on-duty' | 'off-duty';
}

interface QueryOptions {
  orderBy?: { column: keyof Officer; ascending?: boolean };
  filters?: { column: keyof Officer; value: unknown; operator?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' }[];
  limit?: number;
  offset?: number;
}

interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
}

interface UseSupabaseOfficersReturn {
  officers: Officer[];
  loading: boolean;
  error: string | null;
  isRetrying: boolean;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  fetchOfficers: (options?: QueryOptions) => Promise<void>;
  addOfficer: (officer: Omit<OfficerInsert, 'id' | 'created_at' | 'updated_at' | 'created_by'>) => Promise<Officer | null>;
  updateOfficer: (id: string, officer: OfficerUpdate) => Promise<Officer | null>;
  deleteOfficer: (id: string) => Promise<boolean>;
  searchOfficers: (searchTerm: string) => Promise<SearchResultOfficer[]>;
  refreshOfficers: () => Promise<void>;
  retryConnection: () => Promise<void>;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
};

const OFFICERS_STORAGE_KEY = 'bcps-1-officers-backup';
const OFFICERS_CACHE_TS_KEY = 'bcps-1-officers-cache-ts';
// Serve from cache if younger than 3 minutes — avoids re-fetch on remount
const CACHE_TTL_MS = 3 * 60 * 1000;

// Only these columns are needed by the app — avoids pulling search_vector etc.
const OFFICER_SELECT_COLS = 'id,name,rank,badge_number,unit,current_status,created_at,updated_at,created_by';

// ============================================================================
// Utility Functions
// ============================================================================

const getRetryDelay = (attempt: number, config: RetryConfig): number => {
  const exponentialDelay = config.baseDelay * Math.pow(2, attempt);
  return Math.min(exponentialDelay, config.maxDelay);
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const parseError = (error: unknown): string => {
  if (error instanceof Error) {
    const message = error.message;
    if (message.includes('23505')) return 'An officer with this information already exists.';
    if (message.includes('23503')) return 'Referenced record does not exist.';
    if (message.includes('42501') || message.includes('insufficient privilege')) return 'Permission denied.';
    if (message.includes('RLS')) return 'Access denied by security policy.';
    if (message.includes('network') || message.includes('fetch') || message.includes('ECONNREFUSED')) return 'Network connection failed.';
    if (message.includes('timeout') || message.includes('408')) return 'Request timed out.';
    if (message.includes('JWT') || message.includes('auth')) return 'Authentication failed.';
    return message;
  }
  return 'An unexpected error occurred.';
};

const saveToLocalBackup = (officers: Officer[]): void => {
  try {
    localStorage.setItem(OFFICERS_STORAGE_KEY, JSON.stringify(officers));
    localStorage.setItem(OFFICERS_CACHE_TS_KEY, Date.now().toString());
  } catch (err) {
    console.error('Failed to save officers backup:', err);
  }
};

const loadFromLocalBackup = (): { officers: Officer[]; isFresh: boolean } => {
  try {
    const stored = localStorage.getItem(OFFICERS_STORAGE_KEY);
    const ts = localStorage.getItem(OFFICERS_CACHE_TS_KEY);
    if (stored) {
      const isFresh = ts ? Date.now() - Number(ts) < CACHE_TTL_MS : false;
      return { officers: JSON.parse(stored), isFresh };
    }
  } catch (err) {
    console.error('Failed to load officers backup:', err);
  }
  return { officers: [], isFresh: false };
};

// ============================================================================
// Hook Implementation
// ============================================================================

export function useSupabaseOfficers(retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG): UseSupabaseOfficersReturn {
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('connected');

  const retryAttemptRef = useRef(0);
  const isMountedRef = useRef(true);

  const supabaseAvailable = isSupabaseConfigured();

  // ============================================================================
  // Fetch Officers with Retry Logic
  // ============================================================================
  const fetchOfficersWithRetry = useCallback(async (options?: QueryOptions, attempt: number = 0): Promise<Officer[]> => {
    if (!supabaseAvailable) throw new Error('Supabase is not configured');

    try {
      // Use column-filtered select instead of '*'
      let query = supabase
        .from('officers')
        .select(OFFICER_SELECT_COLS);

      if (options?.filters) {
        options.filters.forEach(filter => {
          const op = filter.operator || 'eq';
          const value = filter.value as string | number | boolean;
          switch (op) {
            case 'eq': query = query.eq(filter.column, value); break;
            case 'neq': query = query.neq(filter.column, value); break;
            case 'gt': query = query.gt(filter.column, value); break;
            case 'gte': query = query.gte(filter.column, value); break;
            case 'lt': query = query.lt(filter.column, value); break;
            case 'lte': query = query.lte(filter.column, value); break;
            case 'like': query = query.like(filter.column, `%${value}%`); break;
            case 'ilike': query = query.ilike(filter.column, `%${value}%`); break;
          }
        });
      }

      if (options?.orderBy) {
        query = query.order(options.orderBy.column, { ascending: options.orderBy.ascending ?? true });
      } else {
        query = query.order('name', { ascending: true });
      }

      if (options?.limit) query = query.limit(options.limit);
      if (options?.offset) query = query.range(options.offset, options.offset + (options.limit || 1000) - 1);

      const { data, error: supabaseError } = await query;
      if (supabaseError) throw supabaseError;

      const result = (data || []) as Officer[];
      saveToLocalBackup(result);
      retryAttemptRef.current = 0;
      if (isMountedRef.current) setConnectionStatus('connected');
      return result;
    } catch (err) {
      const errorMessage = parseError(err);
      const isRetryableError =
        errorMessage.includes('network') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('ECONNREFUSED') ||
        (err instanceof Error && err.message.includes('fetch'));

      if (isRetryableError && attempt < retryConfig.maxRetries) {
        const delay = getRetryDelay(attempt, retryConfig);
        if (isMountedRef.current) {
          setIsRetrying(true);
          setConnectionStatus('reconnecting');
        }
        await sleep(delay);
        if (isMountedRef.current) {
          retryAttemptRef.current = attempt + 1;
          return fetchOfficersWithRetry(options, attempt + 1);
        }
      }
      throw err;
    }
  }, [supabaseAvailable, retryConfig]);

  // ============================================================================
  // Public Fetch Method — serves from cache when fresh
  // ============================================================================
  const fetchOfficers = useCallback(async (options?: QueryOptions) => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      setConnectionStatus('disconnected');
      const { officers: backup } = loadFromLocalBackup();
      if (backup.length > 0) setOfficers(backup);
      return;
    }

    setLoading(true);
    setError(null);
    setIsRetrying(false);

    try {
      const data = await fetchOfficersWithRetry(options);
      if (isMountedRef.current) setOfficers(data);
    } catch (err) {
      if (isMountedRef.current) {
        const errorMessage = parseError(err);
        setError(errorMessage);
        setConnectionStatus('disconnected');
        const { officers: backup } = loadFromLocalBackup();
        if (backup.length > 0) {
          setOfficers(backup);
          console.log('Loaded officers from local backup due to error');
        }
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setIsRetrying(false);
      }
    }
  }, [supabaseAvailable, fetchOfficersWithRetry]);

  // ============================================================================
  // Add Officer — select only needed columns on return
  // ============================================================================
  const addOfficer = useCallback(async (
    officer: Omit<OfficerInsert, 'id' | 'created_at' | 'updated_at' | 'created_by'>
  ): Promise<Officer | null> => {
    if (!supabaseAvailable) { setError('Supabase is not configured'); return null; }

    const tempId = `temp-${Date.now()}`;
    const optimisticOfficer: Officer = {
      id: tempId,
      name: officer.name,
      rank: officer.rank,
      badge_number: officer.badge_number || null,
      unit: officer.unit || 'Unassigned',
      current_status: officer.current_status || 'off-duty',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: null,
      search_vector: null,
    };

    setOfficers(prev => [...prev, optimisticOfficer].sort((a, b) => a.name.localeCompare(b.name)));

    try {
      const { data, error: supabaseError } = await supabase
        .from('officers')
        .insert([officer])
        .select(OFFICER_SELECT_COLS)
        .single();

      if (supabaseError) throw supabaseError;

      if (data && isMountedRef.current) {
        const d = data as Officer;
        setOfficers(prev =>
          prev.map(o => o.id === tempId ? d : o).sort((a, b) => a.name.localeCompare(b.name))
        );
        setOfficers(current => { saveToLocalBackup(current); return current; });
      }

      return data as Officer;
    } catch (err) {
      if (isMountedRef.current) {
        setOfficers(prev => prev.filter(o => o.id !== tempId));
        setError(parseError(err));
      }
      throw err;
    }
  }, [supabaseAvailable]);

  // ============================================================================
  // Update Officer — select only needed columns on return
  // ============================================================================
  const updateOfficer = useCallback(async (
    id: string,
    officer: OfficerUpdate
  ): Promise<Officer | null> => {
    if (!supabaseAvailable) { setError('Supabase is not configured'); return null; }

    const originalOfficer = officers.find(o => o.id === id);
    if (!originalOfficer) return null;

    setOfficers(prev =>
      prev.map(o => (o.id === id ? { ...o, ...officer, updated_at: new Date().toISOString() } : o))
        .sort((a, b) => a.name.localeCompare(b.name))
    );

    try {
      const { data, error: supabaseError } = await supabase
        .from('officers')
        .update({ ...officer, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select(OFFICER_SELECT_COLS)
        .single();

      if (supabaseError) throw supabaseError;

      if (data && isMountedRef.current) {
        const d = data as Officer;
        setOfficers(prev =>
          prev.map(o => (o.id === id ? d : o)).sort((a, b) => a.name.localeCompare(b.name))
        );
        setOfficers(current => { saveToLocalBackup(current); return current; });
      }

      return data as Officer;
    } catch (err) {
      if (isMountedRef.current) {
        setOfficers(prev =>
          prev.map(o => (o.id === id ? originalOfficer : o)).sort((a, b) => a.name.localeCompare(b.name))
        );
        setError(parseError(err));
      }
      return null;
    }
  }, [supabaseAvailable, officers]);

  // ============================================================================
  // Delete Officer
  // ============================================================================
  const deleteOfficer = useCallback(async (id: string): Promise<boolean> => {
    if (!supabaseAvailable) { setError('Supabase is not configured'); return false; }

    const originalOfficer = officers.find(o => o.id === id);
    setOfficers(prev => prev.filter(o => o.id !== id));

    try {
      const { error: supabaseError } = await supabase
        .from('officers')
        .delete()
        .eq('id', id);

      if (supabaseError) throw supabaseError;

      if (isMountedRef.current) {
        setOfficers(current => { saveToLocalBackup(current); return current; });
      }
      return true;
    } catch (err) {
      if (isMountedRef.current && originalOfficer) {
        setOfficers(prev => [...prev, originalOfficer].sort((a, b) => a.name.localeCompare(b.name)));
        setError(parseError(err));
      }
      return false;
    }
  }, [supabaseAvailable, officers]);

  // ============================================================================
  // Search Officers — local-only (no extra network round-trip)
  // ============================================================================
  const searchOfficers = useCallback(async (searchTerm: string): Promise<SearchResultOfficer[]> => {
    const source = officers;
    if (!searchTerm.trim()) {
      return source.map(o => ({
        id: o.id, name: o.name, rank: o.rank,
        badge_number: o.badge_number, unit: o.unit, current_status: o.current_status,
      }));
    }
    const lower = searchTerm.toLowerCase();
    return source
      .filter(o =>
        o.name.toLowerCase().includes(lower) ||
        o.rank.toLowerCase().includes(lower) ||
        (o.badge_number || '').toLowerCase().includes(lower) ||
        o.unit.toLowerCase().includes(lower)
      )
      .map(o => ({
        id: o.id, name: o.name, rank: o.rank,
        badge_number: o.badge_number, unit: o.unit, current_status: o.current_status,
      }));
  }, [officers]);

  // ============================================================================
  // Refresh and Retry
  // ============================================================================
  const refreshOfficers = useCallback(async () => {
    await fetchOfficers();
  }, [fetchOfficers]);

  const retryConnection = useCallback(async () => {
    retryAttemptRef.current = 0;
    await fetchOfficers();
  }, [fetchOfficers]);

  // ============================================================================
  // NO realtime subscription — removed to eliminate persistent egress
  // Officers are kept in sync via optimistic updates on mutations.
  // If multi-device sync is needed, use a manual poll or re-enable selectively.
  // ============================================================================

  // ============================================================================
  // Initial Fetch — serve from fresh cache, skip network if data is recent
  // ============================================================================
  useEffect(() => {
    if (supabaseAvailable) {
      const { officers: backup, isFresh } = loadFromLocalBackup();
      if (isFresh && backup.length > 0) {
        // Cache hit — skip network round-trip
        setOfficers(backup);
        setConnectionStatus('connected');
      } else {
        fetchOfficers();
      }
    } else {
      const { officers: backup } = loadFromLocalBackup();
      if (backup.length > 0) setOfficers(backup);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabaseAvailable]);

  // ============================================================================
  // Cleanup
  // ============================================================================
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  return {
    officers,
    loading,
    error,
    isRetrying,
    connectionStatus,
    fetchOfficers,
    addOfficer,
    updateOfficer,
    deleteOfficer,
    searchOfficers,
    refreshOfficers,
    retryConnection,
  };
}
