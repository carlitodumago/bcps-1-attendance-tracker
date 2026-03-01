// ============================================================================
// Supabase Scheduled Tasks Hook
// Handles scheduled status changes with Supabase persistence
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { ScheduledTaskDB } from '../types/database.ts';
import type { ScheduledTask, ScheduledStatus } from '../types/scheduler';

interface UseSupabaseScheduledTasksReturn {
  tasks: ScheduledTask[];
  pendingTasks: ScheduledTask[];
  executedTasks: ScheduledTask[];
  loading: boolean;
  error: string | null;
  addTask: (
    officerId: string,
    officerName: string,
    scheduledStatus: ScheduledStatus,
    scheduledTime: Date
  ) => Promise<ScheduledTask | null>;
  cancelTask: (taskId: string) => Promise<boolean>;
  getTaskForOfficer: (officerId: string) => ScheduledTask | undefined;
  fetchTasks: () => Promise<void>;
  executeTask: (taskId: string) => Promise<boolean>;
}

export function useSupabaseScheduledTasks(): UseSupabaseScheduledTasksReturn {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabaseAvailable = isSupabaseConfigured();

  // Fetch all scheduled tasks
  const fetchTasks = useCallback(async () => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Fetch tasks with officer names
      const { data, error: supabaseError } = await supabase
        .from('scheduled_tasks')
        .select(`
          *,
          officers!inner(name)
        `)
        .order('created_at', { ascending: false });

      if (supabaseError) {
        throw supabaseError;
      }

      // Map to app format with officer names
      const mappedTasks: ScheduledTask[] = (data || []).map((task: ScheduledTaskDB & { officers: { name: string } }) => ({
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

      setTasks(mappedTasks);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch scheduled tasks';
      setError(errorMessage);
      console.error('Error fetching scheduled tasks:', err);
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable]);

  // Add a new scheduled task
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

    setLoading(true);
    setError(null);

    try {
      // Cancel any existing pending task for this officer
      const { error: cancelError } = await supabase
        .from('scheduled_tasks')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
        })
        .eq('officer_id', officerId)
        .eq('status', 'pending');

      if (cancelError) {
        console.error('Error cancelling existing task:', cancelError);
      }

      // Create new task
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

      if (supabaseError) {
        throw supabaseError;
      }

      if (data) {
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

        setTasks(prev => [...prev, newTask]);
        return newTask;
      }

      return null;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to add scheduled task';
      setError(errorMessage);
      console.error('Error adding scheduled task:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable]);

  // Cancel a scheduled task
  const cancelTask = useCallback(async (taskId: string): Promise<boolean> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return false;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: supabaseError } = await supabase
        .from('scheduled_tasks')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
        })
        .eq('id', taskId)
        .eq('status', 'pending');

      if (supabaseError) {
        throw supabaseError;
      }

      setTasks(prev =>
        prev.map(task =>
          task.id === taskId && task.status === 'pending'
            ? { ...task, status: 'cancelled', cancelledAt: new Date().toISOString() }
            : task
        )
      );

      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to cancel task';
      setError(errorMessage);
      console.error('Error cancelling task:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable]);

  // Execute a task (mark as executed)
  const executeTask = useCallback(async (taskId: string): Promise<boolean> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return false;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: supabaseError } = await supabase
        .from('scheduled_tasks')
        .update({
          status: 'executed',
          executed_at: new Date().toISOString(),
        })
        .eq('id', taskId)
        .eq('status', 'pending');

      if (supabaseError) {
        throw supabaseError;
      }

      setTasks(prev =>
        prev.map(task =>
          task.id === taskId && task.status === 'pending'
            ? { ...task, status: 'executed', executedAt: new Date().toISOString() }
            : task
        )
      );

      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to execute task';
      setError(errorMessage);
      console.error('Error executing task:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable]);

  // Get pending task for a specific officer
  const getTaskForOfficer = useCallback((officerId: string): ScheduledTask | undefined => {
    return tasks.find(task => task.officerId === officerId && task.status === 'pending');
  }, [tasks]);

  // Filter tasks by status
  const pendingTasks = tasks.filter(task => task.status === 'pending');
  const executedTasks = tasks.filter(task => task.status === 'executed');

  // Subscribe to real-time changes
  useEffect(() => {
    if (!supabaseAvailable) return;

    const subscription = supabase
      .channel('scheduled_tasks_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'scheduled_tasks' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newTask = payload.new as ScheduledTaskDB;
            // Fetch officer name for the new task
            supabase
              .from('officers')
              .select('name')
              .eq('id', newTask.officer_id)
              .single()
              .then(({ data }) => {
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
                setTasks(prev => [...prev, mappedTask]);
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
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [supabaseAvailable]);

  // Initial fetch
  useEffect(() => {
    if (supabaseAvailable) {
      fetchTasks();
    }
  }, [supabaseAvailable, fetchTasks]);

  return {
    tasks,
    pendingTasks,
    executedTasks,
    loading,
    error,
    addTask,
    cancelTask,
    getTaskForOfficer,
    fetchTasks,
    executeTask,
  };
}
