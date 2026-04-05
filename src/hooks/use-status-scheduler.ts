// ============================================================================
// Status Scheduler Hook
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import type { 
  ScheduledTask, 
  ScheduledStatus, 
  CountdownInfo 
} from '../types/scheduler';
import { SCHEDULER_STORAGE_KEY } from '../types/scheduler';
const getPhTime = (): Date => {
  const now = new Date();
  return new Date(now.toLocaleString('en-PH', { timeZone: 'Asia/Manila' }));
};

interface UseStatusSchedulerReturn {
  pendingTasks: ScheduledTask[];
  executedTasks: ScheduledTask[];
  addTask: (officerId: string, officerName: string, scheduledStatus: ScheduledStatus, scheduledTime: Date) => void;
  cancelTask: (taskId: string) => void;
  getTaskForOfficer: (officerId: string) => ScheduledTask | undefined;
  getCountdown: (scheduledTime: string) => CountdownInfo;
}

/**
 * Custom hook for managing scheduled status changes
 * @param onTaskExecute - Callback function called when a task is executed
 * @returns Object containing tasks and management functions
 */
export function useStatusScheduler(
  onTaskExecute?: (task: ScheduledTask) => void,
  checkOutOfficer?: (officerId: string) => Promise<void>
): UseStatusSchedulerReturn {
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load tasks from localStorage on initial state setup
  const [tasks, setTasks] = useState<ScheduledTask[]>(() => {
    const stored = localStorage.getItem(SCHEDULER_STORAGE_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        console.error('Failed to parse scheduled tasks');
        return [];
      }
    }
    return [];
  });

  // Save tasks to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem(SCHEDULER_STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks]);

  // Check for tasks that need to be executed
  const checkAndExecuteTasks = useCallback(async () => {
    // Current time in Asia/Manila for comparison
    const now = getPhTime();
    
    for (const task of tasks) {
      if (task.status === 'pending') {
        const scheduledTime = new Date(task.scheduledTime);
        
        if (scheduledTime <= now) {
          // Task is due for execution
          setTasks(prevTasks => 
            prevTasks.map(t => 
              t.id === task.id 
                ? { ...t, status: 'executed', executedAt: now.toISOString() }
                : t
            )
          );
          
          // Execute callback
          if (onTaskExecute) {
            onTaskExecute({
              ...task,
              status: 'executed',
              executedAt: now.toISOString()
            });
          }
          
          // Auto check out if off-duty task
          if (task.scheduledStatus === 'off-duty' && checkOutOfficer) {
            try {
              await checkOutOfficer(task.officerId);
            } catch (error) {
              console.error(`Failed to auto-checkout ${task.officerName}:`, error);
            }
          }
        }
      }
    }
  }, [tasks, onTaskExecute, checkOutOfficer]);

  // Set up interval to check for due tasks
  useEffect(() => {
    // Check immediately
    checkAndExecuteTasks();
    
    // Set up interval (check every 10 seconds)
    checkIntervalRef.current = setInterval(async () => {
      await checkAndExecuteTasks();
    }, 10000);
    
    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, [checkAndExecuteTasks]);

  // Add a new scheduled task
  const addTask = useCallback((
    officerId: string, 
    officerName: string, 
    scheduledStatus: ScheduledStatus, 
    scheduledTime: Date
  ) => {
    // Cancel any existing pending task for this officer
    setTasks(prevTasks => 
      prevTasks.map(task => 
        task.officerId === officerId && task.status === 'pending'
          ? { ...task, status: 'cancelled', cancelledAt: new Date().toISOString() }
          : task
      )
    );

    const newTask: ScheduledTask = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      officerId,
      officerName,
      scheduledStatus,
      scheduledTime: scheduledTime.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      createdAt: new Date().toISOString(),
      status: 'pending'
    };

    setTasks(prevTasks => [...prevTasks, newTask]);
  }, []);

  // Cancel a scheduled task
  const cancelTask = useCallback((taskId: string) => {
    setTasks(prevTasks => 
      prevTasks.map(task => 
        task.id === taskId && task.status === 'pending'
          ? { ...task, status: 'cancelled', cancelledAt: new Date().toISOString() }
          : task
      )
    );
  }, []);

  // Get the pending task for a specific officer
  const getTaskForOfficer = useCallback((officerId: string): ScheduledTask | undefined => {
    return tasks.find(task => task.officerId === officerId && task.status === 'pending');
  }, [tasks]);

  // Get countdown information for a scheduled time
  const getCountdown = useCallback((scheduledTime: string): CountdownInfo => {
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

  // Filter tasks by status
  const pendingTasks = tasks.filter(task => task.status === 'pending');
  const executedTasks = tasks.filter(task => task.status === 'executed');

  return {
    pendingTasks,
    executedTasks,
    addTask,
    cancelTask,
    getTaskForOfficer,
    getCountdown
  };
}
