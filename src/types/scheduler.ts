// ============================================================================
// Status Scheduler Types
// ============================================================================

export type ScheduledStatus = 'off-duty' | 'on-duty';

export interface ScheduledTask {
  id: string;
  officerId: string;
  officerName: string;
  scheduledStatus: ScheduledStatus;
  scheduledTime: string; // ISO 8601 timestamp
  timezone: string; // IANA timezone identifier (e.g., 'Asia/Manila')
  createdAt: string;
  executedAt?: string;
  cancelledAt?: string;
  status: 'pending' | 'executed' | 'cancelled' | 'failed';
}

export interface SchedulerState {
  tasks: ScheduledTask[];
}

export interface TimeOption {
  label: string;
  value: string; // Time in HH:mm format
  description?: string;
}

export interface CountdownInfo {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMilliseconds: number;
  isExpired: boolean;
}

// Default time options for quick selection
export const DEFAULT_TIME_OPTIONS: TimeOption[] = [
  { label: '6:00 AM', value: '06:00', description: 'Early morning shift end' },
  { label: '7:00 AM', value: '07:00', description: 'Morning shift end' },
  { label: '8:00 AM', value: '08:00', description: 'Standard morning end' },
  { label: '9:00 AM', value: '09:00', description: 'Late morning' },
  { label: '10:00 AM', value: '10:00', description: 'Morning' },
  { label: '2:00 PM', value: '14:00', description: 'Afternoon shift end' },
  { label: '3:00 PM', value: '15:00', description: 'Afternoon' },
  { label: '4:00 PM', value: '16:00', description: 'Standard afternoon end' },
  { label: '5:00 PM', value: '17:00', description: 'End of business day' },
  { label: '6:00 PM', value: '18:00', description: 'Evening shift end' },
  { label: '8:00 PM', value: '20:00', description: 'Night shift' },
  { label: '10:00 PM', value: '22:00', description: 'Late night' },
  { label: '11:59 PM', value: '23:59', description: 'End of day' },
];

// Storage keys
export const SCHEDULER_STORAGE_KEY = 'bcsp-1-scheduled-tasks';
export const SCHEDULER_WORKER_KEY = 'bcsp-1-scheduler-worker';
