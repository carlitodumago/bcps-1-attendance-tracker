// ============================================================================
// Unified Data Hook
// Combines localStorage (offline) and Supabase (cloud) data management
// Falls back to localStorage when Supabase is not configured
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import { useSupabaseOfficers } from './use-supabase-officers';
import { useSupabaseDutyRecords } from './use-supabase-duty-records';
import { useSupabaseScheduledTasks } from './use-supabase-scheduled-tasks';
import { useStatusScheduler } from './use-status-scheduler';
import type { Officer } from '../types/database';
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

  // Officer operations
  addOfficer: (name: string, rank: string, badgeNumber?: string, unit?: string) => Promise<void>;
  updateOfficer: (id: string, updates: Partial<AppOfficer>) => Promise<void>;
  deleteOfficer: (id: string) => Promise<void>;

  // Duty operations
  checkInOfficer: (officerId: string) => Promise<void>;
  checkOutOfficer: (officerId: string) => Promise<void>;

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
    addOfficer: addDbOfficer,
    updateOfficer: updateDbOfficer,
    deleteOfficer: deleteDbOfficer,
    refreshOfficers,
  } = useSupabaseOfficers();

  const {
    checkInOfficer: checkInDbOfficer,
    checkOutOfficer: checkOutDbOfficer,
    fetchDutyRecordsForOfficer,
    loading: dutyLoading,
    error: dutyError,
  } = useSupabaseDutyRecords();

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

  // Local scheduler hook
  const {
    pendingTasks: localPendingTasks,
    executedTasks: localExecutedTasks,
    addTask: addLocalTask,
    cancelTask: cancelLocalTask,
    getTaskForOfficer: getLocalTaskForOfficer,
  } = useStatusScheduler(onTaskExecute);

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

  useEffect(() => {
    if (supabaseAvailable && dbOfficers.length > 0) {
      const syncOfficers = async () => {
        const appOfficers: AppOfficer[] = [];
        for (const officer of dbOfficers) {
          const dutyRecords = await fetchDutyRecordsForOfficer(officer.id);
          const dutyHistory = dutyRecords.map(record => ({
            timeIn: record.time_in,
            timeOut: record.time_out,
            date: record.duty_date,
          }));
          appOfficers.push(dbOfficerToAppOfficer(officer, dutyHistory));
        }
        setSyncedOfficers(appOfficers);
      };
      syncOfficers();
    }
  }, [supabaseAvailable, dbOfficers, fetchDutyRecordsForOfficer]);

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
      await addDbOfficer({
        name,
        rank,
        badge_number: badgeNumber || null,
        unit: unit || 'Unassigned',
      });
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

  // Check in officer
  const checkInOfficer = useCallback(async (officerId: string) => {
    const now = new Date().toLocaleTimeString('en-PH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
    const today = new Date().toISOString().split('T')[0];

    if (supabaseAvailable) {
      await checkInDbOfficer(officerId);
    } else {
      setLocalOfficers(prev =>
        prev.map(officer => {
          if (officer.id === officerId) {
            return {
              ...officer,
              currentStatus: 'on-duty',
              dutyHistory: [
                ...officer.dutyHistory,
                { timeIn: now, timeOut: null, date: today },
              ],
            };
          }
          return officer;
        })
      );
    }
  }, [supabaseAvailable, checkInDbOfficer]);

  // Check out officer
  const checkOutOfficer = useCallback(async (officerId: string) => {
    const now = new Date().toLocaleTimeString('en-PH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });

    if (supabaseAvailable) {
      await checkOutDbOfficer(officerId);
    } else {
      setLocalOfficers(prev =>
        prev.map(officer => {
          if (officer.id === officerId) {
            const updatedHistory = [...officer.dutyHistory];
            const lastRecord = updatedHistory[updatedHistory.length - 1];
            if (lastRecord && !lastRecord.timeOut) {
              lastRecord.timeOut = now;
            }
            return {
              ...officer,
              currentStatus: 'off-duty',
              dutyHistory: updatedHistory,
            };
          }
          return officer;
        })
      );
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
    pendingTasks,
    executedTasks,
    loading,
    error,
    isSupabaseConnected: supabaseAvailable,
    addOfficer,
    updateOfficer,
    deleteOfficer,
    checkInOfficer,
    checkOutOfficer,
    scheduleTask,
    cancelTask,
    getTaskForOfficer,
    refreshData,
  };
}
