// ============================================================================
// Unified Data Hook
// Combines localStorage (offline) and Supabase (cloud) data management
// Falls back to localStorage when Supabase is not configured
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import { useSupabaseOfficers } from './use-supabase-officers';
import { useSupabaseDutyRecords } from './use-supabase-duty-records';
import { useSupabaseScheduledTasks } from './use-supabase-scheduled-tasks';
import { useStatusScheduler } from './use-status-scheduler';
// getFormattedCurrentTime - using Philippine Time via toLocaleString
const getFormattedCurrentTime = (formatToken: string): string => {
  const now = new Date();
  const phtTime = new Date(now.toLocaleString('en-PH', { timeZone: 'Asia/Manila' }));
  
  const pad = (n: number) => n.toString().padStart(2, '0');
  
  const hour12 = phtTime.getHours() % 12 || 12;
  const minutes = phtTime.getMinutes();
  const seconds = phtTime.getSeconds();
  const ampm = phtTime.getHours() >= 12 ? 'PM' : 'AM';
  const year = phtTime.getFullYear();
  const month = pad(phtTime.getMonth() + 1);
  const day = pad(phtTime.getDate());
  
  return formatToken
    .replace(/hh/g, pad(hour12))
    .replace(/mm/g, pad(minutes))
    .replace(/ss/g, pad(seconds))
    .replace(/a/g, ampm)
    .replace(/yyyy/g, year.toString())
    .replace(/MM/g, month)
    .replace(/dd/g, day);
};
import type { Officer, DutyRecord } from '../types/database';
import type { ScheduledTask, ScheduledStatus } from '../types/scheduler';

// Local storage keys
const OFFICERS_STORAGE_KEY = 'bcsp-1-attendance-tracker';

// App-level Officer type (includes duty history for local storage)
export interface AppOfficer {
  id: string;
  name: string;
  rank: string;
  badgeNumber?: string;
  unit: string;
  currentStatus: 'on-duty' | 'off-duty';
  dutyHistory: {
    timeIn: string;
    timeOut: string | null;
    date: string;
  }[];
}

interface UseUnifiedDataReturn {
  // Data
  officers: AppOfficer[];
  pendingTasks: ScheduledTask[];
  executedTasks: ScheduledTask[];
  loading: boolean;
  error: string | null;
  isSupabaseConnected: boolean;
  realtimeStatus: 'connected' | 'disconnected' | 'reconnecting';

  // Officer operations
  addOfficer: (name: string, rank: string, badgeNumber?: string, unit?: string) => Promise<void>;
  updateOfficer: (id: string, updates: Partial<AppOfficer>) => Promise<void>;
  deleteOfficer: (id: string) => Promise<void>;

  // Duty operations
  dutyRecords: DutyRecord[];
  checkInOfficer: (officerId: string) => Promise<void>;
  checkOutOfficer: (officerId: string) => Promise<boolean>;
  addDutyRecord: (officerId: string, dutyDate: string, timeIn?: string, timeOut?: string | null, notes?: string) => Promise<void>;
  deleteDutyRecord: (id: string) => Promise<boolean>; 

  // Scheduling operations
  scheduleTask: (
    officerId: string,
    officerName: string,
    scheduledStatus: ScheduledStatus,
    scheduledTime: Date
  ) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  getTaskForOfficer: (officerId: string) => ScheduledTask | undefined;

  // Utility
  refreshData: () => Promise<void>;
}

// Helper to convert database officer to app officer
const dbOfficerToAppOfficer = (officer: Officer, dutyHistory: AppOfficer['dutyHistory'] = []): AppOfficer => ({
  id: officer.id,
  name: officer.name,
  rank: officer.rank,
  badgeNumber: officer.badge_number || undefined,
  unit: officer.unit,
  currentStatus: officer.current_status,
  dutyHistory,
});

export function useUnifiedData(onTaskExecute?: (task: ScheduledTask) => void): UseUnifiedDataReturn {
  const supabaseAvailable = isSupabaseConfigured();

  // Supabase hooks
  const {
    officers: dbOfficers,
    loading: officersLoading,
    error: officersError,
    connectionStatus: officersConnectionStatus,
    addOfficer: addDbOfficer,
    updateOfficer: updateDbOfficer,
    deleteOfficer: deleteDbOfficer,
    refreshOfficers,
  } = useSupabaseOfficers();

  const dutyRecordsHook = useSupabaseDutyRecords();
  const {
    dutyRecords: dbDutyRecords,
    checkInOfficer: checkInDbOfficer,
    checkOutOfficer: checkOutDbOfficer,
    fetchDutyRecordsForOfficer,
    onDutyRecordsChange,
    loading: dutyLoading,
    error: dutyError,
  } = dutyRecordsHook;

  const {
    pendingTasks: dbPendingTasks,
    executedTasks: dbExecutedTasks,
    addTask: addDbTask,
    cancelTask: cancelDbTask,
    getTaskForOfficer: getDbTaskForOfficer,
    fetchTasks: fetchDbTasks,
    loading: tasksLoading,
    error: tasksError,
  } = useSupabaseScheduledTasks();

  // Local storage state for officers
  const [localOfficers, setLocalOfficers] = useState<AppOfficer[]>(() => {
    const stored = localStorage.getItem(OFFICERS_STORAGE_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        console.error('Failed to parse stored officers');
        return [];
      }
    }
    return [];
  });

  // Local scheduler hook - after checkOutOfficer defined
  const localCheckOutOfficer = useCallback(async (officerId: string): Promise<void> => {
    if (supabaseAvailable) {
      await checkOutDbOfficer(officerId);
    }
  }, [supabaseAvailable, checkOutDbOfficer]);
  
  const {
    pendingTasks: localPendingTasks,
    executedTasks: localExecutedTasks,
    addTask: addLocalTask,
    cancelTask: cancelLocalTask,
    getTaskForOfficer: getLocalTaskForOfficer,
  } = useStatusScheduler(onTaskExecute, localCheckOutOfficer);

  // Combine loading and error states
  const loading = officersLoading || dutyLoading || tasksLoading;
  const error = officersError || dutyError || tasksError;

  // Save local officers to localStorage
  useEffect(() => {
    if (!supabaseAvailable) {
      localStorage.setItem(OFFICERS_STORAGE_KEY, JSON.stringify(localOfficers));
    }
  }, [localOfficers, supabaseAvailable]);

  // Sync Supabase officers to local format when they change
  const [syncedOfficers, setSyncedOfficers] = useState<AppOfficer[]>([]);
  const hasInitiallySynced = useRef(false);
  const officersWithDutyRecords = useRef<Set<string>>(new Set());

  // Immediate sync - show officers right away without duty records
  useEffect(() => {
    if (!supabaseAvailable) return;
    
    // Use timeout to avoid cascading render warning
    const timeoutId = setTimeout(() => {
      setSyncedOfficers(prev => {
        // Create map of existing officers for quick lookup
        const existingMap = new Map(prev.map(o => [o.id, o]));
        
        // Build new list from dbOfficers, preserving existing duty history
        const newList: AppOfficer[] = dbOfficers.map(officer => {
          const existing = existingMap.get(officer.id);
          if (existing) {
            // CRITICAL: Always use current_status from Supabase (dbOfficers) for realtime sync
            // This ensures status changes from other devices are immediately reflected
            return {
              ...existing,
              name: officer.name,
              rank: officer.rank,
              badgeNumber: officer.badge_number || undefined,
              unit: officer.unit,
              currentStatus: officer.current_status, // Always use fresh status from Supabase
            };
          }
          // New officer - create with empty duty history
          return dbOfficerToAppOfficer(officer, []);
        });
        
        return newList;
      });
      
      hasInitiallySynced.current = true;
    }, 0);
    
    return () => clearTimeout(timeoutId);
  }, [supabaseAvailable, dbOfficers]);

  // Async duty records sync - fetches duty history in background
  const syncOfficersWithDutyRecords = useCallback(async () => {
    if (!supabaseAvailable || dbOfficers.length === 0) return;
    
    const appOfficers: AppOfficer[] = [];
    for (const officer of dbOfficers) {
      // Skip if we already have duty records for this officer
      if (officersWithDutyRecords.current.has(officer.id)) {
        const existing = syncedOfficers.find(o => o.id === officer.id);
        if (existing) {
          appOfficers.push(existing);
          continue;
        }
      }
      
      const dutyRecords = await fetchDutyRecordsForOfficer(officer.id);
      const dutyHistory = dutyRecords.map(record => ({
        timeIn: record.time_in,
        timeOut: record.time_out,
        date: record.duty_date,
      }));
      officersWithDutyRecords.current.add(officer.id);
      appOfficers.push(dbOfficerToAppOfficer(officer, dutyHistory));
    }
    setSyncedOfficers(appOfficers);
  }, [supabaseAvailable, dbOfficers, fetchDutyRecordsForOfficer, syncedOfficers]);

  // Realtime duty status update - no refetch needed
  const updateOfficerDutyStatus = useCallback((officerId: string, status: 'on-duty' | 'off-duty', dutyRecord?: { time_in: string; time_out: string | null; duty_date: string }) => {
    setSyncedOfficers(prev =>
      prev.map(officer => {
        if (officer.id !== officerId) return officer;
        
        const updatedHistory = [...officer.dutyHistory];
        
        if (status === 'on-duty' && dutyRecord) {
          // Add new duty record
          updatedHistory.push({
            timeIn: dutyRecord.time_in,
            timeOut: dutyRecord.time_out,
            date: dutyRecord.duty_date,
          });
        } else if (status === 'off-duty' && dutyRecord) {
          // Update last record with time_out
          const lastRecord = updatedHistory[updatedHistory.length - 1];
          if (lastRecord && lastRecord.date === dutyRecord.duty_date) {
            lastRecord.timeOut = dutyRecord.time_out;
          }
        }
        
        return {
          ...officer,
          currentStatus: status,
          dutyHistory: updatedHistory,
        };
      })
    );
  }, []);

  // Initial sync and duty records change subscription
  useEffect(() => {
    if (!supabaseAvailable) return;
    
    // Initial sync - use timeout to avoid cascading render warning
    if (!hasInitiallySynced.current && dbOfficers.length > 0) {
      const timeoutId = setTimeout(() => {
        syncOfficersWithDutyRecords();
      }, 0);
      return () => clearTimeout(timeoutId);
    }
    
    // Subscribe to duty records changes for calendar only - don't change officer status
    let unsubscribe: (() => void) | undefined;
    if (onDutyRecordsChange) {
      unsubscribe = onDutyRecordsChange((officerId, status, dutyRecord) => {
        // Don't update officer status - calendar only tracks assignments
        // The duty record will still be visible in the calendar
      });
    }
    
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [supabaseAvailable, dbOfficers.length, onDutyRecordsChange, syncOfficersWithDutyRecords]);

  // Use appropriate data source
  const officers = supabaseAvailable ? syncedOfficers : localOfficers;
  const pendingTasks = supabaseAvailable ? dbPendingTasks : localPendingTasks;
  const executedTasks = supabaseAvailable ? dbExecutedTasks : localExecutedTasks;

  // Add officer
  const addOfficer = useCallback(async (
    name: string,
    rank: string,
    badgeNumber?: string,
    unit?: string
  ) => {
    if (supabaseAvailable) {
      const result = await addDbOfficer({
        name,
        rank,
        badge_number: badgeNumber || null,
        unit: unit || 'Unassigned',
        current_status: 'off-duty',
      });
      if (!result) {
        throw new Error('Failed to add officer to Supabase');
      }
    } else {
      const newOfficer: AppOfficer = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        name: name.trim(),
        rank: rank.trim(),
        badgeNumber: badgeNumber?.trim(),
        unit: unit?.trim() || 'Unassigned',
        currentStatus: 'off-duty',
        dutyHistory: [],
      };
      setLocalOfficers(prev => [newOfficer, ...prev]);
    }
  }, [supabaseAvailable, addDbOfficer]);

  // Update officer
  const updateOfficer = useCallback(async (id: string, updates: Partial<AppOfficer>) => {
    if (supabaseAvailable) {
      await updateDbOfficer(id, {
        name: updates.name,
        rank: updates.rank,
        badge_number: updates.badgeNumber,
        unit: updates.unit,
        current_status: updates.currentStatus,
      });
    } else {
      setLocalOfficers(prev =>
        prev.map(officer =>
          officer.id === id ? { ...officer, ...updates } : officer
        )
      );
    }
  }, [supabaseAvailable, updateDbOfficer]);

  // Delete officer
  const deleteOfficer = useCallback(async (id: string) => {
    if (supabaseAvailable) {
      await deleteDbOfficer(id);
    } else {
      setLocalOfficers(prev => prev.filter(officer => officer.id !== id));
    }
  }, [supabaseAvailable, deleteDbOfficer]);

  // Refs to track latest state for callbacks
  const syncedOfficersRef = useRef(syncedOfficers);
  const localOfficersRef = useRef(localOfficers);
  
  // Update refs when state changes
  useEffect(() => {
    syncedOfficersRef.current = syncedOfficers;
  }, [syncedOfficers]);
  
  useEffect(() => {
    localOfficersRef.current = localOfficers;
  }, [localOfficers]);

  // Check in officer with optimistic update
const checkInOfficer = useCallback(async (officerId: string) => {
    const now = new Date();
    const phtTime = new Date(now.toLocaleString('en-PH', { timeZone: 'Asia/Manila' }));
    const utcTime = new Date(phtTime.getTime() - (8 * 3600000));
    const timeIn24 = `${utcTime.getHours().toString().padStart(2, '0')}:${utcTime.getMinutes().toString().padStart(2, '0')}:${utcTime.getSeconds().toString().padStart(2, '0')}`;
    const today = getFormattedCurrentTime('yyyy-MM-dd');

    // Store original state for potential rollback (using refs to get latest)
    const originalOfficers = supabaseAvailable ? [...syncedOfficersRef.current] : [...localOfficersRef.current];

    // Optimistic update - update UI immediately
    const optimisticUpdate = (prev: AppOfficer[]) =>
      prev.map(officer => {
        if (officer.id === officerId) {
          return {
            ...officer,
            currentStatus: 'on-duty' as const,
            dutyHistory: [
              ...officer.dutyHistory,
              { timeIn: timeIn24, timeOut: null, date: today },
            ],
          };
        }
        return officer;
      });

    if (supabaseAvailable) {
      setSyncedOfficers(prev => optimisticUpdate(prev));
    } else {
      setLocalOfficers(prev => optimisticUpdate(prev));
    }

    // Async persistence to Supabase
    if (supabaseAvailable) {
      try {
        await checkInDbOfficer(officerId);
      } catch (error) {
        // Rollback on error
        setSyncedOfficers(originalOfficers);
        throw error;
      }
    }
  }, [supabaseAvailable, checkInDbOfficer]);

  // Check out officer with optimistic update
  const checkOutOfficer = useCallback(async (officerId: string): Promise<boolean> => {
    const now = new Date();
    const phtTime = new Date(now.toLocaleString('en-PH', { timeZone: 'Asia/Manila' }));
    const utcTime = new Date(phtTime.getTime() - (8 * 3600000));
    const timeOut24 = `${utcTime.getHours().toString().padStart(2, '0')}:${utcTime.getMinutes().toString().padStart(2, '0')}:${utcTime.getSeconds().toString().padStart(2, '0')}`;

    // Store original state for potential rollback (using refs to get latest)
    const originalOfficers = supabaseAvailable ? [...syncedOfficersRef.current] : [...localOfficersRef.current];

    // Optimistic update - update UI immediately
    const optimisticUpdate = (prev: AppOfficer[]) =>
      prev.map(officer => {
        if (officer.id === officerId) {
          const updatedHistory = [...officer.dutyHistory];
          const lastRecord = updatedHistory[updatedHistory.length - 1];
          if (lastRecord && !lastRecord.timeOut) {
            lastRecord.timeOut = timeOut24;
          }
          return {
            ...officer,
            currentStatus: 'off-duty' as const,
            dutyHistory: updatedHistory,
          };
        }
        return officer;
      });

    if (supabaseAvailable) {
      setSyncedOfficers(prev => optimisticUpdate(prev));
    } else {
      setLocalOfficers(prev => optimisticUpdate(prev));
    }

    // Async persistence to Supabase
    if (supabaseAvailable) {
      try {
        console.log('use-unified-data: Calling checkOutDbOfficer for:', officerId);
        const result = await checkOutDbOfficer(officerId);
        console.log('use-unified-data: checkOutDbOfficer result:', result);
        if (!result) {
          // Rollback if operation failed
          if (supabaseAvailable) {
            setSyncedOfficers(originalOfficers);
          } else {
            setLocalOfficers(originalOfficers);
          }
          throw new Error('Failed to check out officer');
        }
        return result;
      } catch (error) {
        // Rollback on error
        console.error('use-unified-data: checkOutOfficer error:', error);
        if (supabaseAvailable) {
          setSyncedOfficers(originalOfficers);
        } else {
          setLocalOfficers(originalOfficers);
        }
        throw error;
      }
    } else {
      // Local mode - just return true since we already updated the state
      return true;
    }
  }, [supabaseAvailable, checkOutDbOfficer]);

  // Schedule task
  const scheduleTask = useCallback(async (
    officerId: string,
    officerName: string,
    scheduledStatus: ScheduledStatus,
    scheduledTime: Date
  ) => {
    if (supabaseAvailable) {
      await addDbTask(officerId, officerName, scheduledStatus, scheduledTime);
    } else {
      addLocalTask(officerId, officerName, scheduledStatus, scheduledTime);
    }
  }, [supabaseAvailable, addDbTask, addLocalTask]);

  // Cancel task
  const cancelTask = useCallback(async (taskId: string) => {
    if (supabaseAvailable) {
      await cancelDbTask(taskId);
    } else {
      cancelLocalTask(taskId);
    }
  }, [supabaseAvailable, cancelDbTask, cancelLocalTask]);

  // Get task for officer
  const getTaskForOfficer = useCallback((officerId: string): ScheduledTask | undefined => {
    if (supabaseAvailable) {
      return getDbTaskForOfficer(officerId);
    }
    return getLocalTaskForOfficer(officerId);
  }, [supabaseAvailable, getDbTaskForOfficer, getLocalTaskForOfficer]);

  // Refresh data
  const refreshData = useCallback(async () => {
    if (supabaseAvailable) {
      await refreshOfficers();
      await fetchDbTasks();
    }
  }, [supabaseAvailable, refreshOfficers, fetchDbTasks]);

    return {
    officers,
    dutyRecords: supabaseAvailable ? dbDutyRecords : [], // Export dutyRecords
    pendingTasks,
    executedTasks,
    loading,
    error,
    isSupabaseConnected: supabaseAvailable,
    realtimeStatus: supabaseAvailable ? officersConnectionStatus : 'disconnected',
    addOfficer,
    updateOfficer,
    deleteOfficer,
    checkInOfficer,
    checkOutOfficer,
    addDutyRecord: useCallback(async (officerId: string, dutyDate: string, timeIn?: string, timeOut?: string | null, notes?: string) => {
      if (supabaseAvailable) {
        // Get current time without timezone conversion - store as-is
        const now = new Date();
        // Use provided timeIn or default to current time, but not undefined/empty string
        const timeInValue = timeIn && timeIn.trim() ? timeIn : now.toTimeString().slice(0, 8);
        
        await dutyRecordsHook.addDutyRecord({
          officer_id: officerId,
          duty_date: dutyDate,
          time_in: timeInValue,
          time_out: timeOut !== undefined && timeOut !== null && timeOut.trim() !== '' ? timeOut : undefined,
          notes,
        });
      } else {
        // Local fallback: add to current officer dutyHistory
        const now = new Date();
        
        setLocalOfficers(prev => prev.map(o => {
          if (o.id === officerId) {
            return {
              ...o,
              dutyHistory: [...o.dutyHistory, {
                timeIn: timeIn || now.toLocaleTimeString('en-PH', {hour: '2-digit', minute:'2-digit'}),
                timeOut: timeOut ?? null,
                date: dutyDate
              }]
            };
          }
          return o;
        }));
      }
    }, [supabaseAvailable, dutyRecordsHook.addDutyRecord]),

    deleteDutyRecord: supabaseAvailable ? dutyRecordsHook.deleteDutyRecord : (() => Promise.resolve(false)),
    scheduleTask,
    cancelTask,
    getTaskForOfficer,
    refreshData,
  };


}
