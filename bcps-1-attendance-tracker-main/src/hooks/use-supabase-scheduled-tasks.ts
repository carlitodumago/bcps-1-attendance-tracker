// ============================================================================
// Production-Ready Supabase Scheduled Tasks Hook
// Handles scheduled status changes with Supabase persistence
// Features: Real-time updates, error handling, retry logic, optimistic updates
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
const getPhTime = (): Date => {
  const now = new Date();
  return new Date(now.toLocaleString('en-PH', { timeZone: 'Asia/Manila' }));
};
import type { ScheduledTaskDB } from '../types/database';
import type { ScheduledTask, ScheduledStatus, CountdownInfo } from '../types/scheduler';

// ============================================================================
// Types
// ============================================================================

interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
}

interface UseSupabaseScheduledTasksReturn {
  tasks: ScheduledTask[];
  pendingTasks: ScheduledTask[];
  executedTasks: ScheduledTask[];
  loading: boolean;
  error: string | null;
  isRetrying: boolean;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  addTask: (
    officerId: string,
    officerName: string,
    scheduledStatus: ScheduledStatus,
    scheduledTime: Date
  ) => Promise<ScheduledTask | null>;
  cancelTask: (taskId: string) => Promise<boolean>;
  executeTask: (taskId: string) => Promise<boolean>;
  getTaskForOfficer: (officerId: string) => ScheduledTask | undefined;
  fetchTasks: () => Promise<void>;
  getCountdown: (scheduledTime: string) => CountdownInfo;
  refreshTasks: () => Promise<void>;
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

const SCHEDULED_TASKS_STORAGE_KEY = 'bcps-1-scheduled-tasks-backup';

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
    
    if (message.includes('42501') || message.includes('insufficient privilege')) {
      return 'Permission denied. Please check your access rights.';
    }
    if (message.includes('RLS')) {
      return 'Access denied by security policy.';
    }
    if (message.includes('network') || message.includes('fetch') || message.includes('ECONNREFUSED')) {
      return 'Network connection failed. Please check your internet connection.';
    }
    if (message.includes('timeout') || message.includes('408')) {
      return 'Request timed out. Please try again.';
    }
    
    return message;
  }
  return 'An unexpected error occurred. Please try again.';
};

const saveToLocalBackup = (tasks: ScheduledTask[]): void => {
  try {
    localStorage.setItem(SCHEDULED_TASKS_STORAGE_KEY, JSON.stringify(tasks));
  } catch (err) {
    console.error('Failed to save scheduled tasks backup:', err);
  }
};

const loadFromLocalBackup = (): ScheduledTask[] => {
  try {
    const stored = localStorage.getItem(SCHEDULED_TASKS_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (err) {
    console.error('Failed to load scheduled tasks backup:', err);
  }
  return [];
};

// ============================================================================
// Hook Implementation
// ============================================================================

export function useSupabaseScheduledTasks(retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG): UseSupabaseScheduledTasksReturn {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('connected');

  const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const retryAttemptRef = useRef(0);
  const isMountedRef = useRef(true);

  const supabaseAvailable = isSupabaseConfigured();

  // ============================================================================
  // Core Fetch with Retry Logic
  // ============================================================================
  const fetchWithRetry = useCallback(async <T,>(
    fetchFn: () => Promise<T>,
    attempt: number = 0
  ): Promise<T> => {
    try {
      const result = await fetchFn();
      retryAttemptRef.current = 0;
      if (isMountedRef.current) {
        setConnectionStatus('connected');
      }
      return result;
    } catch (err) {
      const errorMessage = parseError(err);
      const isRetryableError = 
        errorMessage.includes('network') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('ECONNREFUSED');

      if (isRetryableError && attempt < retryConfig.maxRetries) {
        const delay = getRetryDelay(attempt, retryConfig);
        if (isMountedRef.current) {
          setIsRetrying(true);
          setConnectionStatus('reconnecting');
        }
        await sleep(delay);
        if (isMountedRef.current) {
          retryAttemptRef.current = attempt + 1;
          return fetchWithRetry(fetchFn, attempt + 1);
        }
      }
      throw err;
    }
  }, [retryConfig]);

  // ============================================================================
  // Fetch All Tasks
  // ============================================================================
  const fetchTasks = useCallback(async () => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      setConnectionStatus('disconnected');
      const backup = loadFromLocalBackup();
      setTasks(backup);
      return;
    }

    setLoading(true);
    setError(null);
    setIsRetrying(false);

    try {
      const data = await fetchWithRetry(async () => {
        const { data, error: supabaseError } = await supabase
          .from('scheduled_tasks')
          .select(`
            *,
            officers!inner(name)
          `)
          .order('created_at', { ascending: false });

        if (supabaseError) throw supabaseError;
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

      if (isMountedRef.current) {
        setTasks(mappedTasks);
        saveToLocalBackup(mappedTasks);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(parseError(err));
        setConnectionStatus('disconnected');
        const backup = loadFromLocalBackup();
        if (backup.length > 0) setTasks(backup);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setIsRetrying(false);
      }
    }
  }, [supabaseAvailable, fetchWithRetry]);

  // ============================================================================
  // Add Task with Optimistic Update
  // ============================================================================
  const addTask = useCallback(async (
    officerId: string,
    officerName: string,
    scheduledStatus: ScheduledStatus,
    scheduledTime: Date
  ): Promise<ScheduledTask | null> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return null;
    }

    const tempId = `temp-${Date.now()}`;
    const optimisticTask: ScheduledTask = {
      id: tempId,
      officerId,
      officerName,
      scheduledStatus,
      scheduledTime: scheduledTime.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    setTasks(prev => [...prev, optimisticTask]);

    try {
      // Cancel any existing pending task for this officer
      await fetchWithRetry(async () => {
        const { error: cancelError } = await supabase
          .from('scheduled_tasks')
          .update({
            status: 'cancelled',
            cancelled_at: new Date().toISOString(),
          })
          .eq('officer_id', officerId)
          .eq('status', 'pending');

        if (cancelError) console.error('Error cancelling existing task:', cancelError);
      });

      const data = await fetchWithRetry(async () => {
        const newTaskData = {
          officer_id: officerId,
          scheduled_status: scheduledStatus,
          scheduled_time: scheduledTime.toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          status: 'pending' as const,
        };

        const { data, error: supabaseError } = await supabase
          .from('scheduled_tasks')
          .insert([newTaskData])
          .select()
          .single();

        if (supabaseError) throw supabaseError;
        return data;
      });

      if (data && isMountedRef.current) {
        const newTask: ScheduledTask = {
          id: data.id,
          officerId: data.officer_id,
          officerName,
          scheduledStatus: data.scheduled_status,
          scheduledTime: data.scheduled_time,
          timezone: data.timezone,
          createdAt: data.created_at,
          status: data.status,
        };

        setTasks(prev => prev.map(t => t.id === tempId ? newTask : t));
        saveToLocalBackup(tasks.map(t => t.id === tempId ? newTask : t));
        return newTask;
      }

      return null;
    } catch (err) {
      if (isMountedRef.current) {
        setTasks(prev => prev.filter(t => t.id !== tempId));
        setError(parseError(err));
      }
      return null;
    }
  }, [supabaseAvailable, tasks, fetchWithRetry]);

  // ============================================================================
  // Cancel Task with Optimistic Update
  // ============================================================================
  const cancelTask = useCallback(async (taskId: string): Promise<boolean> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return false;
    }

    const originalTask = tasks.find(t => t.id === taskId);
    if (!originalTask) return false;

    setTasks(prev =>
      prev.map(t =>
        t.id === taskId && t.status === 'pending'
          ? { ...t, status: 'cancelled', cancelledAt: new Date().toISOString() }
          : t
      )
    );

    try {
      await fetchWithRetry(async () => {
        const { error: supabaseError } = await supabase
          .from('scheduled_tasks')
          .update({
            status: 'cancelled',
            cancelled_at: new Date().toISOString(),
          })
          .eq('id', taskId)
          .eq('status', 'pending');

        if (supabaseError) throw supabaseError;
      });

      if (isMountedRef.current) {
        saveToLocalBackup(tasks.map(t =>
          t.id === taskId ? { ...t, status: 'cancelled' as const, cancelledAt: new Date().toISOString() } : t
        ));
      }
      return true;
    } catch (err) {
      if (isMountedRef.current) {
        setTasks(prev =>
          prev.map(t => (t.id === taskId ? originalTask : t))
        );
        setError(parseError(err));
      }
      return false;
    }
  }, [supabaseAvailable, tasks, fetchWithRetry]);

  // ============================================================================
  // Execute Task with Optimistic Update
  // ============================================================================
  const executeTask = useCallback(async (taskId: string): Promise<boolean> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return false;
    }

    const originalTask = tasks.find(t => t.id === taskId);
    if (!originalTask) return false;

    setTasks(prev =>
      prev.map(t =>
        t.id === taskId && t.status === 'pending'
          ? { ...t, status: 'executed', executedAt: new Date().toISOString() }
          : t
      )
    );

    try {
      await fetchWithRetry(async () => {
        const { error: supabaseError } = await supabase
          .from('scheduled_tasks')
          .update({
            status: 'executed',
            executed_at: new Date().toISOString(),
          })
          .eq('id', taskId)
          .eq('status', 'pending');

        if (supabaseError) throw supabaseError;
      });

      if (isMountedRef.current) {
        saveToLocalBackup(tasks.map(t =>
          t.id === taskId ? { ...t, status: 'executed' as const, executedAt: new Date().toISOString() } : t
        ));
      }
      return true;
    } catch (err) {
      if (isMountedRef.current) {
        setTasks(prev =>
          prev.map(t => (t.id === taskId ? originalTask : t))
        );
        setError(parseError(err));
      }
      return false;
    }
  }, [supabaseAvailable, tasks, fetchWithRetry]);

  // ============================================================================
  // Get Pending Task for Officer
  // ============================================================================
  const getTaskForOfficer = useCallback((officerId: string): ScheduledTask | undefined => {
    return tasks.find(task => task.officerId === officerId && task.status === 'pending');
  }, [tasks]);

  // ============================================================================
  // Get Countdown for Scheduled Time
  // ============================================================================
  const getCountdown = useCallback((scheduledTime: string): CountdownInfo => {
    // Current time in Asia/Manila for consistent comparison
    const now = getPhTime();
    const scheduled = new Date(scheduledTime);
    const diff = scheduled.getTime() - now.getTime();

    if (diff <= 0) {
      return {
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        totalMilliseconds: 0,
        isExpired: true
      };
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    return {
      days,
      hours,
      minutes,
      seconds,
      totalMilliseconds: diff,
      isExpired: false
    };
  }, []);

  // ============================================================================
  // Refresh and Retry Methods
  // ============================================================================
  const refreshTasks = useCallback(async () => {
    await fetchTasks();
  }, [fetchTasks]);

  const retryConnection = useCallback(async () => {
    retryAttemptRef.current = 0;
    await fetchTasks();
  }, [fetchTasks]);

  const executeTaskRef = useRef(executeTask);
  
  useEffect(() => {
    executeTaskRef.current = executeTask;
  }, [executeTask]);

  // ============================================================================
  // Automatic Task Execution
  // ============================================================================
  const checkAndExecuteTasks = useCallback(async () => {
    const now = getPhTime();
    
    for (const task of tasks) {
      if (task.status === 'pending') {
        const scheduledTime = new Date(task.scheduledTime);
        
        if (scheduledTime <= now) {
          await executeTaskRef.current(task.id);
        }
      }
    }
  }, [tasks]);

  useEffect(() => {
    checkAndExecuteTasks();
    
    const interval = setInterval(() => {
      checkAndExecuteTasks();
    }, 10000);
    
    return () => clearInterval(interval);
  }, [checkAndExecuteTasks]);

  // ============================================================================
  // Real-time Subscription
  // ============================================================================
  useEffect(() => {
    if (!supabaseAvailable) return;

    const setupSubscription = () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
      }

      subscriptionRef.current = supabase
        .channel('scheduled_tasks_changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'scheduled_tasks' },
          (payload) => {
            if (!isMountedRef.current) return;

            if (payload.eventType === 'INSERT') {
              const newTask = payload.new as ScheduledTaskDB;
              supabase
                .from('officers')
                .select('name')
                .eq('id', newTask.officer_id)
                .single()
                .then(({ data }) => {
                  if (isMountedRef.current) {
                    const mappedTask: ScheduledTask = {
                      id: newTask.id,
                      officerId: newTask.officer_id,
                      officerName: data?.name || 'Unknown',
                      scheduledStatus: newTask.scheduled_status,
                      scheduledTime: newTask.scheduled_time,
                      timezone: newTask.timezone,
                      createdAt: newTask.created_at,
                      executedAt: newTask.executed_at || undefined,
                      cancelledAt: newTask.cancelled_at || undefined,
                      status: newTask.status,
                    };
                    setTasks(prev => {
                      if (prev.find(t => t.id === mappedTask.id)) return prev;
                      return [...prev, mappedTask];
                    });
                  }
                });
            } else if (payload.eventType === 'UPDATE') {
              const updatedTask = payload.new as ScheduledTaskDB;
              setTasks(prev =>
                prev.map(task =>
                  task.id === updatedTask.id
                    ? {
                        ...task,
                        status: updatedTask.status,
                        executedAt: updatedTask.executed_at || undefined,
                        cancelledAt: updatedTask.cancelled_at || undefined,
                      }
                    : task
                )
              );
            } else if (payload.eventType === 'DELETE') {
              setTasks(prev => prev.filter(task => task.id !== payload.old.id));
            }

            setTasks(current => {
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
      fetchTasks();
    } else {
      const backup = loadFromLocalBackup();
      if (backup.length > 0) {
        setTasks(backup);
      }
    }
  }, [supabaseAvailable, fetchTasks]);

  // ============================================================================
  // Cleanup
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

  // Filter tasks by status
  const pendingTasks = tasks.filter(task => task.status === 'pending');
  const executedTasks = tasks.filter(task => task.status === 'executed');

  return {
    tasks,
    pendingTasks,
    executedTasks,
    loading,
    error,
    isRetrying,
    connectionStatus,
    addTask,
    cancelTask,
    executeTask,
    getTaskForOfficer,
    fetchTasks,
    getCountdown,
    refreshTasks,
    retryConnection,
  };
}
