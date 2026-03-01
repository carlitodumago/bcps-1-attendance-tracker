// ============================================================================
// Supabase Officers Hook
// Handles all officer-related CRUD operations with Supabase
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { Officer, OfficerInsert, OfficerUpdate } from '../types/database';

interface SearchResultOfficer {
  id: string;
  name: string;
  rank: string;
  badge_number: string | null;
  unit: string;
  current_status: 'on-duty' | 'off-duty';
}

interface UseSupabaseOfficersReturn {
  officers: Officer[];
  loading: boolean;
  error: string | null;
  fetchOfficers: () => Promise<void>;
  addOfficer: (officer: Omit<OfficerInsert, 'id' | 'created_at' | 'updated_at' | 'created_by'>) => Promise<Officer | null>;
  updateOfficer: (id: string, officer: OfficerUpdate) => Promise<Officer | null>;
  deleteOfficer: (id: string) => Promise<boolean>;
  searchOfficers: (searchTerm: string) => Promise<SearchResultOfficer[]>;
  refreshOfficers: () => Promise<void>;
}

export function useSupabaseOfficers(): UseSupabaseOfficersReturn {
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if Supabase is configured
  const supabaseAvailable = isSupabaseConfigured();

  // Fetch all officers
  const fetchOfficers = useCallback(async () => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: supabaseError } = await supabase
        .from('officers')
        .select('*')
        .order('name', { ascending: true });

      if (supabaseError) {
        throw supabaseError;
      }

      setOfficers(data || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch officers';
      setError(errorMessage);
      console.error('Error fetching officers:', err);
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable]);

  // Add a new officer
  const addOfficer = useCallback(async (
    officer: Omit<OfficerInsert, 'id' | 'created_at' | 'updated_at' | 'created_by'>
  ): Promise<Officer | null> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: supabaseError } = await supabase
        .from('officers')
        .insert([officer])
        .select()
        .single();

      if (supabaseError) {
        throw supabaseError;
      }

      // Update local state
      if (data) {
        setOfficers(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      }

      return data;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to add officer';
      setError(errorMessage);
      console.error('Error adding officer:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable]);

  // Update an officer
  const updateOfficer = useCallback(async (
    id: string,
    officer: OfficerUpdate
  ): Promise<Officer | null> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return null;
    }

    setLoading(true);
    setError(null);

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

      // Update local state
      if (data) {
        setOfficers(prev =>
          prev.map(o => (o.id === id ? data : o)).sort((a, b) => a.name.localeCompare(b.name))
        );
      }

      return data;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update officer';
      setError(errorMessage);
      console.error('Error updating officer:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable]);

  // Delete an officer
  const deleteOfficer = useCallback(async (id: string): Promise<boolean> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return false;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: supabaseError } = await supabase
        .from('officers')
        .delete()
        .eq('id', id);

      if (supabaseError) {
        throw supabaseError;
      }

      // Update local state
      setOfficers(prev => prev.filter(o => o.id !== id));
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete officer';
      setError(errorMessage);
      console.error('Error deleting officer:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable]);

  // Search officers using full-text search
  const searchOfficers = useCallback(async (searchTerm: string): Promise<SearchResultOfficer[]> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return [];
    }

    if (!searchTerm.trim()) {
      return officers;
    }

    setLoading(true);
    setError(null);

    try {
      // Use the search_officers function for full-text search
      const { data, error: supabaseError } = await supabase
        .rpc('search_officers', { p_search_term: searchTerm });

      if (supabaseError) {
        throw supabaseError;
      }

      return (data || []) as SearchResultOfficer[];
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to search officers';
      setError(errorMessage);
      console.error('Error searching officers:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable, officers]);

  // Refresh officers data
  const refreshOfficers = useCallback(async () => {
    await fetchOfficers();
  }, [fetchOfficers]);

  // Initial fetch
  useEffect(() => {
    if (supabaseAvailable) {
      fetchOfficers();
    }
  }, [supabaseAvailable, fetchOfficers]);

  // Subscribe to real-time changes
  useEffect(() => {
    if (!supabaseAvailable) return;

    const subscription = supabase
      .channel('officers_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'officers' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setOfficers(prev => [...prev, payload.new as Officer].sort((a, b) => a.name.localeCompare(b.name)));
          } else if (payload.eventType === 'UPDATE') {
            setOfficers(prev =>
              prev.map(o => (o.id === payload.new.id ? payload.new as Officer : o))
            );
          } else if (payload.eventType === 'DELETE') {
            setOfficers(prev => prev.filter(o => o.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [supabaseAvailable]);

  return {
    officers,
    loading,
    error,
    fetchOfficers,
    addOfficer,
    updateOfficer,
    deleteOfficer,
    searchOfficers,
    refreshOfficers,
  };
}
