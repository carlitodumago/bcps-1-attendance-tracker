// ============================================================================
// Calendar State Hook — localStorage only (egress-optimized)
// The user_preferences table doesn't exist in the current DB schema.
// Calendar state (currentMonth, selectedDate) is persisted locally only.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { formatISOInPHT, utcISOToPHT } from '../lib/timezone';

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

const LOCAL_STORAGE_KEY = 'bcps-1-calendar-state-backup';

const loadSavedState = (): CalendarState => {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const currentMonth = parsed.currentMonth ? utcISOToPHT(parsed.currentMonth) : new Date();
      const selectedDate = parsed.selectedDate ? utcISOToPHT(parsed.selectedDate) : null;
      return {
        currentMonth: isNaN(currentMonth.getTime()) ? new Date() : currentMonth,
        selectedDate: selectedDate && !isNaN(selectedDate.getTime()) ? selectedDate : null,
      };
    }
  } catch { /* ignore */ }
  return { currentMonth: new Date(), selectedDate: null };
};

export function useCalendarState(): UseCalendarStateReturn {
  const saved = loadSavedState();
  const [currentMonth, setCurrentMonthState] = useState<Date>(saved.currentMonth);
  const [selectedDate, setSelectedDateState] = useState<Date | null>(saved.selectedDate);

  const persist = useCallback((state: CalendarState) => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
        currentMonth: formatISOInPHT(state.currentMonth),
        selectedDate: state.selectedDate ? formatISOInPHT(state.selectedDate) : null,
      }));
    } catch { /* ignore */ }
  }, []);

  const setCurrentMonth = useCallback((date: Date) => {
    setCurrentMonthState(date);
    setSelectedDateState(prev => { persist({ currentMonth: date, selectedDate: prev }); return prev; });
  }, [persist]);

  const setSelectedDate = useCallback((date: Date | null) => {
    setSelectedDateState(date);
    setCurrentMonthState(prev => { persist({ currentMonth: prev, selectedDate: date }); return prev; });
  }, [persist]);

  // Persist on every change
  useEffect(() => {
    persist({ currentMonth, selectedDate });
  }, [currentMonth, selectedDate, persist]);

  return { currentMonth, selectedDate, setCurrentMonth, setSelectedDate, loading: false, error: null };
}
