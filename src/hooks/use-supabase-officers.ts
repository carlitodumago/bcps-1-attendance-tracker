// ============================================================================
// Production-Ready Supabase Officers Hook
// Handles all officer-related CRUD operations with Supabase
// Features: Real-time updates, error handling, retry logic, optimistic updates
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
  maxRetries: 5,
  baseDelay: 1000,
  maxDelay: 30000,
};

const OFFICERS_STORAGE_KEY = 'bcps-1-officers-backup';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate exponential backoff delay
 */
const getRetryDelay = (attempt: number, config: RetryConfig): number => {
  const exponentialDelay = config.baseDelay * Math.pow(2, attempt);
  return Math.min(exponentialDelay, config.maxDelay);
};

/**
 * Sleep utility for retry delays
 */
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Parse Supabase error for user-friendly messages
 */
const parseError = (error: unknown): string => {
  if (error instanceof Error) {
    // Check for specific Supabase/Postgres error codes
    const message = error.message;
    
    if (message.includes('23505')) {
      return 'An officer with this information already exists.';
    }
    if (message.includes('23503')) {
      return 'Referenced record does not exist.';
    }
    if (message.includes('42501') || message.includes('insufficient privilege')) {
      return 'Permission denied. Please check your access rights.';
    }
    if (message.includes('RLS')) {
      return 'Access denied by security policy. Please contact your administrator.';
    }
    if (message.includes('network') || message.includes('fetch') || message.includes('ECONNREFUSED')) {
      return 'Network connection failed. Please check your internet connection.';
    }
    if (message.includes('timeout') || message.includes('408')) {
      return 'Request timed out. Please try again.';
    }
    if (message.includes('JWT') || message.includes('auth')) {
      return 'Authentication failed. Please sign in again.';
    }
    
    return message;
  }
  return 'An unexpected error occurred. Please try again.';
};

/**
 * Save officers to localStorage as backup
 */
const saveToLocalBackup = (officers: Officer[]): void => {
  try {
    localStorage.setItem(OFFICERS_STORAGE_KEY, JSON.stringify(officers));
  } catch (err) {
    console.error('Failed to save officers backup:', err);
  }
};

/**
 * Load officers from localStorage backup
 */
const loadFromLocalBackup = (): Officer[] => {
  try {
    const stored = localStorage.getItem(OFFICERS_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (err) {
    console.error('Failed to load officers backup:', err);
  }
  return [];
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
  
  // Refs for managing subscriptions and retry state
  const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const retryAttemptRef = useRef(0);
  const isMountedRef = useRef(true);

  const supabaseAvailable = isSupabaseConfigured();

  // ============================================================================
  // Fetch Officers with Retry Logic
  // ============================================================================
  const fetchOfficersWithRetry = useCallback(async (options?: QueryOptions, attempt: number = 0): Promise<Officer[]> => {
    if (!supabaseAvailable) {
      throw new Error('Supabase is not configured');
    }

    try {
      let query = supabase
        .from('officers')
        .select('*');

      // Apply filters
      if (options?.filters) {
        options.filters.forEach(filter => {
          const op = filter.operator || 'eq';
          const value = filter.value as string | number | boolean;
          switch (op) {
            case 'eq':
              query = query.eq(filter.column, value);
              break;
            case 'neq':
              query = query.neq(filter.column, value);
              break;
            case 'gt':
              query = query.gt(filter.column, value);
              break;
            case 'gte':
              query = query.gte(filter.column, value);
              break;
            case 'lt':
              query = query.lt(filter.column, value);
              break;
            case 'lte':
              query = query.lte(filter.column, value);
              break;
            case 'like':
              query = query.like(filter.column, `%${value}%`);
              break;
            case 'ilike':
              query = query.ilike(filter.column, `%${value}%`);
              break;
          }
        });
      }

      // Apply ordering
      if (options?.orderBy) {
        query = query.order(options.orderBy.column, { 
          ascending: options.orderBy.ascending ?? true 
        });
      } else {
        query = query.order('name', { ascending: true });
      }

      // Apply pagination
      if (options?.limit) {
        query = query.limit(options.limit);
      }
      if (options?.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 1000) - 1);
      }

      const { data, error: supabaseError } = await query;

      if (supabaseError) {
        throw supabaseError;
      }

      const result = data || [];
      
      // Save successful result to local backup
      saveToLocalBackup(result);
      
      // Reset retry attempt on success
      retryAttemptRef.current = 0;
      
      if (isMountedRef.current) {
        setConnectionStatus('connected');
      }
      
      return result;
    } catch (err) {
      const errorMessage = parseError(err);
      
      // Check if this is a network error that we should retry
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
  // Public Fetch Method
  // ============================================================================
  const fetchOfficers = useCallback(async (options?: QueryOptions) => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      setConnectionStatus('disconnected');
      // Load from backup if available
      const backup = loadFromLocalBackup();
      if (backup.length > 0) {
        setOfficers(backup);
      }
      return;
    }

    setLoading(true);
    setError(null);
    setIsRetrying(false);

    try {
      const data = await fetchOfficersWithRetry(options);
      if (isMountedRef.current) {
        setOfficers(data);
      }
    } catch (err) {
      if (isMountedRef.current) {
        const errorMessage = parseError(err);
        setError(errorMessage);
        setConnectionStatus('disconnected');
        
        // Fallback to local backup on error
        const backup = loadFromLocalBackup();
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
  // Add Officer with Optimistic Update
  // ============================================================================
  const addOfficer = useCallback(async (
    officer: Omit<OfficerInsert, 'id' | 'created_at' | 'updated_at' | 'created_by'>
  ): Promise<Officer | null> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return null;
    }

    // Generate temporary ID for optimistic update
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

    // Optimistic update
    setOfficers(prev => [...prev, optimisticOfficer].sort((a, b) => a.name.localeCompare(b.name)));

    try {
      const { data, error: supabaseError } = await supabase
        .from('officers')
        .insert([officer])
        .select()
        .single();

      if (supabaseError) {
        throw supabaseError;
      }

      // Replace optimistic entry with real data
      if (data && isMountedRef.current) {
        setOfficers(prev => 
          prev.map(o => o.id === tempId ? data : o).sort((a, b) => a.name.localeCompare(b.name))
        );
        saveToLocalBackup([...officers.filter(o => o.id !== tempId), data]);
      }

      return data;
    } catch (err) {
      // Rollback optimistic update
      if (isMountedRef.current) {
        setOfficers(prev => prev.filter(o => o.id !== tempId));
        const errorMessage = parseError(err);
        setError(errorMessage);
      }
      throw err;
    }
  }, [supabaseAvailable, officers]);

  // ============================================================================
  // Update Officer with Optimistic Update
  // ============================================================================
  const updateOfficer = useCallback(async (
    id: string,
    officer: OfficerUpdate
  ): Promise<Officer | null> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return null;
    }

    // Store original for rollback
    const originalOfficer = officers.find(o => o.id === id);
    if (!originalOfficer) return null;

    // Optimistic update
    setOfficers(prev =>
      prev.map(o => (o.id === id ? { ...o, ...officer, updated_at: new Date().toISOString() } : o))
        .sort((a, b) => a.name.localeCompare(b.name))
    );

    try {
      const { data, error: supabaseError } = await supabase
        .from('officers')
        .update({ ...officer, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (supabaseError) {
        throw supabaseError;
      }

      if (data && isMountedRef.current) {
        setOfficers(prev =>
          prev.map(o => (o.id === id ? data : o)).sort((a, b) => a.name.localeCompare(b.name))
        );
        saveToLocalBackup(officers.map(o => o.id === id ? data : o));
      }

      return data;
    } catch (err) {
      // Rollback
      if (isMountedRef.current) {
        setOfficers(prev =>
          prev.map(o => (o.id === id ? originalOfficer : o)).sort((a, b) => a.name.localeCompare(b.name))
        );
        const errorMessage = parseError(err);
        setError(errorMessage);
      }
      return null;
    }
  }, [supabaseAvailable, officers]);

  // ============================================================================
  // Delete Officer with Optimistic Update
  // ============================================================================
  const deleteOfficer = useCallback(async (id: string): Promise<boolean> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return false;
    }

    // Store original for rollback
    const originalOfficer = officers.find(o => o.id === id);
    
    // Optimistic update
    setOfficers(prev => prev.filter(o => o.id !== id));

    try {
      const { error: supabaseError } = await supabase
        .from('officers')
        .delete()
        .eq('id', id);

      if (supabaseError) {
        throw supabaseError;
      }

      if (isMountedRef.current) {
        saveToLocalBackup(officers.filter(o => o.id !== id));
      }

      return true;
    } catch (err) {
      // Rollback
      if (isMountedRef.current && originalOfficer) {
        setOfficers(prev => [...prev, originalOfficer].sort((a, b) => a.name.localeCompare(b.name)));
        const errorMessage = parseError(err);
        setError(errorMessage);
      }
      return false;
    }
  }, [supabaseAvailable, officers]);

  // ============================================================================
  // Search Officers with Fallback
  // ============================================================================
  const searchOfficers = useCallback(async (searchTerm: string): Promise<SearchResultOfficer[]> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      // Fallback to local search
      return officers.filter(o => 
        o.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        o.rank.toLowerCase().includes(searchTerm.toLowerCase())
      ).map(o => ({
        id: o.id,
        name: o.name,
        rank: o.rank,
        badge_number: o.badge_number,
        unit: o.unit,
        current_status: o.current_status,
      }));
    }

    if (!searchTerm.trim()) {
      return officers.map(o => ({
        id: o.id,
        name: o.name,
        rank: o.rank,
        badge_number: o.badge_number,
        unit: o.unit,
        current_status: o.current_status,
      }));
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: supabaseError } = await supabase
        .rpc('search_officers', { p_search_term: searchTerm });

      if (supabaseError) {
        throw supabaseError;
      }

      return (data || []) as SearchResultOfficer[];
    } catch (err) {
      const errorMessage = parseError(err);
      setError(errorMessage);
      // Fallback to local search on error
      return officers.filter(o => 
        o.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        o.rank.toLowerCase().includes(searchTerm.toLowerCase())
      ).map(o => ({
        id: o.id,
        name: o.name,
        rank: o.rank,
        badge_number: o.badge_number,
        unit: o.unit,
        current_status: o.current_status,
      }));
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable, officers]);

  // ============================================================================
  // Refresh and Retry Methods
  // ============================================================================
  const refreshOfficers = useCallback(async () => {
    await fetchOfficers();
  }, [fetchOfficers]);

  const retryConnection = useCallback(async () => {
    retryAttemptRef.current = 0;
    await fetchOfficers();
  }, [fetchOfficers]);

  // ============================================================================
  // Real-time Subscription Setup
  // ============================================================================
  useEffect(() => {
    if (!supabaseAvailable) return;

    const setupSubscription = () => {
      // Clean up existing subscription
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
      }

      subscriptionRef.current = supabase
        .channel('officers_changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'officers' },
          (payload) => {
            if (!isMountedRef.current) return;

            if (payload.eventType === 'INSERT') {
              const newOfficer = payload.new as Officer;
              setOfficers(prev => {
                // Avoid duplicates
                if (prev.find(o => o.id === newOfficer.id)) return prev;
                return [...prev, newOfficer].sort((a, b) => a.name.localeCompare(b.name));
              });
            } else if (payload.eventType === 'UPDATE') {
              const updatedOfficer = payload.new as Officer;
              setOfficers(prev =>
                prev.map(o => (o.id === updatedOfficer.id ? updatedOfficer : o))
                  .sort((a, b) => a.name.localeCompare(b.name))
              );
            } else if (payload.eventType === 'DELETE') {
              setOfficers(prev => prev.filter(o => o.id !== payload.old.id));
            }
            
            // Update local backup after any change
            setOfficers(current => {
              saveToLocalBackup(current);
              return current;
            });
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            setConnectionStatus('connected');
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            setConnectionStatus('disconnected');
          }
        });
    };

    setupSubscription();

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
        subscriptionRef.current = null;
      }
    };
  }, [supabaseAvailable]);

  // ============================================================================
  // Initial Fetch
  // ============================================================================
  useEffect(() => {
    if (supabaseAvailable) {
      fetchOfficers();
    } else {
      // Load from backup if Supabase not available
      const backup = loadFromLocalBackup();
      if (backup.length > 0) {
        setOfficers(backup);
      }
    }
  }, [supabaseAvailable, fetchOfficers]);

  // ============================================================================
  // Cleanup on Unmount
  // ============================================================================
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
      }
    };
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
