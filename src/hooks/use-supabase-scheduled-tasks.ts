// ============================================================================
// Supabase Scheduled Tasks Hook — Egress-Optimized
// Changes: select specific columns, no realtime sub, localStorage cache
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

const getPhTime = (): Date => {
  const now = new Date();
  return new Date(now.toLocaleString('en-PH', { timeZone: 'Asia/Manila' }));
};

import type { ScheduledTaskDB } from '../types/database';
import type { ScheduledTask, ScheduledStatus, CountdownInfo } from '../types/scheduler';

interface RetryConfig { maxRetries: number; baseDelay: number; maxDelay: number; }

interface UseSupabaseScheduledTasksReturn {
  tasks: ScheduledTask[];
  pendingTasks: ScheduledTask[];
  executedTasks: ScheduledTask[];
  loading: boolean;
  error: string | null;
  isRetrying: boolean;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  addTask: (officerId: string, officerName: string, scheduledStatus: ScheduledStatus, scheduledTime: Date) => Promise<ScheduledTask | null>;
  cancelTask: (taskId: string) => Promise<boolean>;
  executeTask: (taskId: string) => Promise<boolean>;
  getTaskForOfficer: (officerId: string) => ScheduledTask | undefined;
  fetchTasks: () => Promise<void>;
  getCountdown: (scheduledTime: string) => CountdownInfo;
  refreshTasks: () => Promise<void>;
  retryConnection: () => Promise<void>;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = { maxRetries: 3, baseDelay: 1000, maxDelay: 10000 };
const SCHEDULED_TASKS_STORAGE_KEY = 'bcps-1-scheduled-tasks-backup';
const TASKS_CACHE_TS_KEY = 'bcps-1-tasks-cache-ts';
const CACHE_TTL_MS = 3 * 60 * 1000;

// Only fetch pending tasks + recently executed (last 24h) to minimise rows
const TASK_COLS = 'id,officer_id,scheduled_status,scheduled_time,timezone,created_at,executed_at,cancelled_at,status';

const getRetryDelay = (attempt: number, config: RetryConfig) =>
  Math.min(config.baseDelay * Math.pow(2, attempt), config.maxDelay);

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

const parseError = (error: unknown): string => {
  if (error instanceof Error) {
    const m = error.message;
    if (m.includes('42501') || m.includes('insufficient privilege')) return 'Permission denied.';
    if (m.includes('network') || m.includes('fetch') || m.includes('ECONNREFUSED')) return 'Network connection failed.';
    if (m.includes('timeout') || m.includes('408')) return 'Request timed out.';
    return m;
  }
  return 'An unexpected error occurred.';
};

const saveToLocalBackup = (tasks: ScheduledTask[]): void => {
  try {
    localStorage.setItem(SCHEDULED_TASKS_STORAGE_KEY, JSON.stringify(tasks));
    localStorage.setItem(TASKS_CACHE_TS_KEY, Date.now().toString());
  } catch { /* ignore */ }
};

const loadFromLocalBackup = (): { tasks: ScheduledTask[]; isFresh: boolean } => {
  try {
    const stored = localStorage.getItem(SCHEDULED_TASKS_STORAGE_KEY);
    const ts = localStorage.getItem(TASKS_CACHE_TS_KEY);
    if (stored) {
      const isFresh = ts ? Date.now() - Number(ts) < CACHE_TTL_MS : false;
      return { tasks: JSON.parse(stored), isFresh };
    }
  } catch { /* ignore */ }
  return { tasks: [], isFresh: false };
};

export function useSupabaseScheduledTasks(retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG): UseSupabaseScheduledTasksReturn {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('connected');

  const retryAttemptRef = useRef(0);
  const isMountedRef = useRef(true);
  const supabaseAvailable = isSupabaseConfigured();

  const fetchWithRetry = useCallback(async <T,>(fetchFn: () => Promise<T>, attempt = 0): Promise<T> => {
    try {
      const result = await fetchFn();
      retryAttemptRef.current = 0;
      if (isMountedRef.current) setConnectionStatus('connected');
      return result;
    } catch (err) {
      const msg = parseError(err);
      const retryable = msg.includes('network') || msg.includes('timeout') || msg.includes('ECONNREFUSED');
      if (retryable && attempt < retryConfig.maxRetries) {
        if (isMountedRef.current) { setIsRetrying(true); setConnectionStatus('reconnecting'); }
        await sleep(getRetryDelay(attempt, retryConfig));
        if (isMountedRef.current) { retryAttemptRef.current = attempt + 1; return fetchWithRetry(fetchFn, attempt + 1); }
      }
      throw err;
    }
  }, [retryConfig]);

  // ============================================================================
  // Fetch Tasks — pending only + last 24h executed, join officer name inline
  // ============================================================================
  const fetchTasks = useCallback(async () => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured'); setConnectionStatus('disconnected');
      const { tasks } = loadFromLocalBackup(); setTasks(tasks); return;
    }

    setLoading(true); setError(null); setIsRetrying(false);

    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const data = await fetchWithRetry(async () => {
        // Fetch pending tasks + recent executed (within 24h) only
        const { data, error: err } = await supabase
          .from('scheduled_tasks')
          .select(`${TASK_COLS}, officers!inner(name)`)
          .or(`status.eq.pending,and(status.eq.executed,executed_at.gte.${yesterday})`)
          .order('created_at', { ascending: false })
          .limit(100);
        if (err) throw err;
        return data || [];
      });

      const mappedTasks: ScheduledTask[] = (data as (ScheduledTaskDB & { officers: { name: string } })[]).map(task => ({
        id: task.id,
        officerId: task.officer_id,
        officerName: task.officers?.name || 'Unknown',
        scheduledStatus: task.scheduled_status,
        scheduledTime: task.scheduled_time,
        timezone: task.timezone,
        createdAt: task.created_at,
        executedAt: task.executed_at || undefined,
        cancelledAt: task.cancelled_at || undefined,
        status: task.status,
      }));

      if (isMountedRef.current) { setTasks(mappedTasks); saveToLocalBackup(mappedTasks); }
    } catch (err) {
      if (isMountedRef.current) {
        setError(parseError(err)); setConnectionStatus('disconnected');
        const { tasks } = loadFromLocalBackup();
        if (tasks.length > 0) setTasks(tasks);
      }
    } finally {
      if (isMountedRef.current) { setLoading(false); setIsRetrying(false); }
    }
  }, [supabaseAvailable, fetchWithRetry]);

  // ============================================================================
  // Add Task
  // ============================================================================
  const addTask = useCallback(async (
    officerId: string, officerName: string, scheduledStatus: ScheduledStatus, scheduledTime: Date
  ): Promise<ScheduledTask | null> => {
    if (!supabaseAvailable) { setError('Supabase is not configured'); return null; }

    const tempId = `temp-${Date.now()}`;
    const optimistic: ScheduledTask = {
      id: tempId, officerId, officerName, scheduledStatus,
      scheduledTime: scheduledTime.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      createdAt: new Date().toISOString(), status: 'pending',
    };
    setTasks(prev => [...prev, optimistic]);

    try {
      // Cancel any existing pending task for this officer
      await fetchWithRetry(async () => {
        const { error: cancelError } = await supabase
          .from('scheduled_tasks')
          .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
          .eq('officer_id', officerId)
          .eq('status', 'pending');
        if (cancelError) console.error('Error cancelling existing task:', cancelError);
      });

      const data = await fetchWithRetry(async () => {
        const { data, error: err } = await supabase
          .from('scheduled_tasks')
          .insert([{
            officer_id: officerId,
            scheduled_status: scheduledStatus,
            scheduled_time: scheduledTime.toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            status: 'pending' as const,
          }])
          .select(TASK_COLS)
          .single();
        if (err) throw err;
        return data as ScheduledTaskDB;
      });

      if (data && isMountedRef.current) {
        const newTask: ScheduledTask = {
          id: data.id, officerId: data.officer_id, officerName,
          scheduledStatus: data.scheduled_status, scheduledTime: data.scheduled_time,
          timezone: data.timezone, createdAt: data.created_at, status: data.status,
        };
        setTasks(prev => {
          const updated = prev.map(t => t.id === tempId ? newTask : t);
          saveToLocalBackup(updated);
          return updated;
        });
        return newTask;
      }
      return null;
    } catch (err) {
      if (isMountedRef.current) { setTasks(prev => prev.filter(t => t.id !== tempId)); setError(parseError(err)); }
      return null;
    }
  }, [supabaseAvailable, fetchWithRetry]);

  // ============================================================================
  // Cancel Task
  // ============================================================================
  const cancelTask = useCallback(async (taskId: string): Promise<boolean> => {
    if (!supabaseAvailable) { setError('Supabase is not configured'); return false; }
    const original = tasks.find(t => t.id === taskId);
    if (!original) return false;

    setTasks(prev => prev.map(t =>
      t.id === taskId && t.status === 'pending'
        ? { ...t, status: 'cancelled' as const, cancelledAt: new Date().toISOString() } : t
    ));

    try {
      await fetchWithRetry(async () => {
        const { error: err } = await supabase
          .from('scheduled_tasks')
          .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
          .eq('id', taskId).eq('status', 'pending');
        if (err) throw err;
      });
      setTasks(current => { saveToLocalBackup(current); return current; });
      return true;
    } catch (err) {
      if (isMountedRef.current) { setTasks(prev => prev.map(t => t.id === taskId ? original : t)); setError(parseError(err)); }
      return false;
    }
  }, [supabaseAvailable, tasks, fetchWithRetry]);

  // ============================================================================
  // Execute Task
  // ============================================================================
  const executeTask = useCallback(async (taskId: string): Promise<boolean> => {
    if (!supabaseAvailable) { setError('Supabase is not configured'); return false; }
    const original = tasks.find(t => t.id === taskId);
    if (!original) return false;

    setTasks(prev => prev.map(t =>
      t.id === taskId && t.status === 'pending'
        ? { ...t, status: 'executed' as const, executedAt: new Date().toISOString() } : t
    ));

    try {
      await fetchWithRetry(async () => {
        const { error: err } = await supabase
          .from('scheduled_tasks')
          .update({ status: 'executed', executed_at: new Date().toISOString() })
          .eq('id', taskId).eq('status', 'pending');
        if (err) throw err;
      });
      setTasks(current => { saveToLocalBackup(current); return current; });
      return true;
    } catch (err) {
      if (isMountedRef.current) { setTasks(prev => prev.map(t => t.id === taskId ? original : t)); setError(parseError(err)); }
      return false;
    }
  }, [supabaseAvailable, tasks, fetchWithRetry]);

  const getTaskForOfficer = useCallback((officerId: string): ScheduledTask | undefined =>
    tasks.find(task => task.officerId === officerId && task.status === 'pending'),
  [tasks]);

  const getCountdown = useCallback((scheduledTime: string): CountdownInfo => {
    const now = getPhTime();
    const diff = new Date(scheduledTime).getTime() - now.getTime();
    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, totalMilliseconds: 0, isExpired: true };
    return {
      days: Math.floor(diff / 86400000),
      hours: Math.floor((diff % 86400000) / 3600000),
      minutes: Math.floor((diff % 3600000) / 60000),
      seconds: Math.floor((diff % 60000) / 1000),
      totalMilliseconds: diff, isExpired: false,
    };
  }, []);

  const refreshTasks = useCallback(async () => { await fetchTasks(); }, [fetchTasks]);
  const retryConnection = useCallback(async () => { retryAttemptRef.current = 0; await fetchTasks(); }, [fetchTasks]);

  // ============================================================================
  // Automatic Task Execution — local poll, no Supabase read each tick
  // ============================================================================
  const executeTaskRef = useRef(executeTask);
  useEffect(() => { executeTaskRef.current = executeTask; }, [executeTask]);

  const checkAndExecuteTasks = useCallback(async () => {
    const now = getPhTime();
    for (const task of tasks) {
      if (task.status === 'pending' && new Date(task.scheduledTime) <= now) {
        await executeTaskRef.current(task.id);
      }
    }
  }, [tasks]);

  useEffect(() => {
    checkAndExecuteTasks();
    const interval = setInterval(checkAndExecuteTasks, 10000);
    return () => clearInterval(interval);
  }, [checkAndExecuteTasks]);

  // ============================================================================
  // NO realtime subscription — removed to eliminate persistent egress
  // ============================================================================

  // ============================================================================
  // Initial Fetch — cache-first
  // ============================================================================
  useEffect(() => {
    if (supabaseAvailable) {
      const { tasks: cached, isFresh } = loadFromLocalBackup();
      if (isFresh && cached.length > 0) {
        setTasks(cached);
        setConnectionStatus('connected');
      } else {
        fetchTasks();
      }
    } else {
      const { tasks: cached } = loadFromLocalBackup();
      if (cached.length > 0) setTasks(cached);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabaseAvailable]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const executedTasks = tasks.filter(t => t.status === 'executed');

  return {
    tasks, pendingTasks, executedTasks, loading, error, isRetrying, connectionStatus,
    addTask, cancelTask, executeTask, getTaskForOfficer, fetchTasks,
    getCountdown, refreshTasks, retryConnection,
  };
}
