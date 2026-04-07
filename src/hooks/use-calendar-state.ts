// ============================================================================
// Calendar State Hook with Supabase Persistence
// Manages calendar view state (currentMonth, selectedDate) in Supabase
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { formatISOInPHT, utcISOToPHT } from '../lib/timezone';

// ============================================================================
// Types
// ============================================================================

interface CalendarState {
  currentMonth: Date;
  selectedDate: Date | null;
}

interface UseCalendarStateReturn {
  currentMonth: Date;
  selectedDate: Date | null;
  setCurrentMonth: (date: Date) => void;
  setSelectedDate: (date: Date | null) => void;
  loading: boolean;
  error: string | null;
}

// ============================================================================
// Constants
// ============================================================================

const CALENDAR_STATE_KEY = 'calendar-state';
const LOCAL_STORAGE_KEY = 'bcps-1-calendar-state-backup';

// ============================================================================
// Hook Implementation
// ============================================================================

export function useCalendarState(): UseCalendarStateReturn {
  const [currentMonth, setCurrentMonthState] = useState<Date>(() => {
    // Try to restore from localStorage first (faster)
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.currentMonth) {
          const date = utcISOToPHT(parsed.currentMonth);
          if (!isNaN(date.getTime())) {
            return date;
          }
        }
      }
    } catch {
      // Ignore localStorage errors
    }
    return new Date();
  });

  const [selectedDate, setSelectedDateState] = useState<Date | null>(() => {
    // Try to restore from localStorage first (faster)
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.selectedDate) {
          const date = utcISOToPHT(parsed.selectedDate);
          if (!isNaN(date.getTime())) {
            return date;
          }
        }
      }
    } catch {
      // Ignore localStorage errors
    }
    return null;
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const supabaseAvailable = isSupabaseConfigured();

  // ============================================================================
  // Save to localStorage as backup
  // ============================================================================

  const saveToLocalBackup = useCallback((state: CalendarState) => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
        currentMonth: formatISOInPHT(state.currentMonth),
        selectedDate: state.selectedDate ? formatISOInPHT(state.selectedDate) : null,
      }));
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // ============================================================================
  // Load from Supabase
  // ============================================================================

  const loadFromSupabase = useCallback(async () => {
    if (!supabaseAvailable) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: supabaseError } = await supabase
        .from('user_preferences')
        .select('preference_value')
        .eq('preference_key', CALENDAR_STATE_KEY)
        .single();

      if (supabaseError) {
        // If no record found, that's okay - we'll use defaults
        if (supabaseError.code === 'PGRST116') {
          return;
        }
        throw supabaseError;
      }

      if (data?.preference_value && isMountedRef.current) {
        const state = data.preference_value as { currentMonth?: string; selectedDate?: string | null };
        
        if (state.currentMonth) {
          const monthDate = utcISOToPHT(state.currentMonth);
          if (!isNaN(monthDate.getTime())) {
            setCurrentMonthState(monthDate);
          }
        }

        if (state.selectedDate) {
          const selectedDateObj = utcISOToPHT(state.selectedDate);
          if (!isNaN(selectedDateObj.getTime())) {
            setSelectedDateState(selectedDateObj);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load calendar state from Supabase:', err);
      if (isMountedRef.current) {
        setError('Failed to load calendar state');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [supabaseAvailable]);

  // ============================================================================
  // Save to Supabase
  // ============================================================================

  const saveToSupabase = useCallback(async (state: CalendarState) => {
    if (!supabaseAvailable) {
      return;
    }

    try {
      const preferenceValue = {
        currentMonth: formatISOInPHT(state.currentMonth),
        selectedDate: state.selectedDate ? formatISOInPHT(state.selectedDate) : null,
      };

      const { error: supabaseError } = await supabase
        .from('user_preferences')
        .upsert({
          preference_key: CALENDAR_STATE_KEY,
          preference_value: preferenceValue,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id,preference_key',
        });

      if (supabaseError) {
        throw supabaseError;
      }
    } catch (err) {
      console.error('Failed to save calendar state to Supabase:', err);
      if (isMountedRef.current) {
        setError('Failed to save calendar state');
      }
    }
  }, [supabaseAvailable]);

  // ============================================================================
  // Public Methods
  // ============================================================================

  const setCurrentMonth = useCallback((date: Date) => {
    setCurrentMonthState(date);
    const newState: CalendarState = { currentMonth: date, selectedDate };
    saveToLocalBackup(newState);
    saveToSupabase(newState);
  }, [selectedDate, saveToLocalBackup, saveToSupabase]);

  const setSelectedDate = useCallback((date: Date | null) => {
    setSelectedDateState(date);
    const newState: CalendarState = { currentMonth, selectedDate: date };
    saveToLocalBackup(newState);
    saveToSupabase(newState);
  }, [currentMonth, saveToLocalBackup, saveToSupabase]);

  // ============================================================================
  // Effects
  // ============================================================================

  // Load from Supabase on mount
  useEffect(() => {
    isMountedRef.current = true;
    loadFromSupabase();

    return () => {
      isMountedRef.current = false;
    };
  }, [loadFromSupabase]);

  // Save to localStorage whenever state changes
  useEffect(() => {
    saveToLocalBackup({ currentMonth, selectedDate });
  }, [currentMonth, selectedDate, saveToLocalBackup]);

  return {
    currentMonth,
    selectedDate,
    setCurrentMonth,
    setSelectedDate,
    loading,
    error,
  };
}
