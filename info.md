# BCPS-1 Attendance Tracker

A police attendance tracking application for managing officer duty status and scheduling automatic status changes.

## Features

### Core Features
- Officer registration with name, rank, badge number, and unit
- Real-time duty status tracking (On Duty / Off Duty)
- Duty history with time-in and time-out records
- Calendar view showing officers on duty for each day
- Search functionality for officers
- Edit and delete officer records

### Scheduled Status Changes (NEW)
The application now supports **persistent scheduling** of automatic status changes:

- **Schedule Off-Duty Button**: Officers on duty can have their off-duty time scheduled
- **Default Time**: Automatically defaults to 8:00 AM tomorrow
- **Time Selection**: Users can customize the scheduled time via dropdown
- **Real-time Countdown**: Visual countdown showing time until scheduled status change
- **Persistent Storage**: Scheduled tasks are saved to localStorage
- **Background Execution**: Tasks execute automatically even if:
  - The application is closed
  - The browser tab is inactive
  - The device enters sleep mode
- **Service Worker**: Handles background task execution with notification support

### Time Options
Available scheduling times:
- 6:00 AM - Early morning shift end
- 7:00 AM - Morning shift end
- 8:00 AM - Standard morning end (default)
- 9:00 AM - Late morning
- 10:00 AM - Morning
- 2:00 PM - Afternoon shift end
- 3:00 PM - Afternoon
- 4:00 PM - Standard afternoon end
- 5:00 PM - End of business day
- 6:00 PM - Evening shift end
- 8:00 PM - Night shift
- 10:00 PM - Late night
- 11:59 PM - End of day

### Timezone Support
All scheduled times are stored with timezone awareness using the user's local timezone (IANA format like 'Asia/Manila').

## Technical Stack

- React 19 + TypeScript
- Vite for build tooling
- Tailwind CSS for styling
- shadcn/ui components
- date-fns for date manipulation
- Service Workers for background processing
- LocalStorage for client-side persistence

## Architecture

### Components
- `ScheduleOffDutyButton`: Button with modal for scheduling off-duty time
- `ScheduledTasksPanel`: Panel displaying all scheduled tasks with countdowns

### Hooks
- `useStatusScheduler`: Core hook for managing scheduled tasks
- `useServiceWorker`: Hook for service worker registration and communication

### Service Worker
- `public/scheduler-worker.js`: Background service worker for task execution
- Uses IndexedDB for reliable storage
- Periodic sync checks every 30 seconds
- Push notification support for task completion

### Types
- `ScheduledTask`: Interface for scheduled status change tasks
- `CountdownInfo`: Interface for countdown display data

## Data Storage

### Officers
Stored in localStorage key: `bcsp-1-attendance-tracker`

### Scheduled Tasks
Stored in localStorage key: `bcsp-1-scheduled-tasks`

Task structure:
```typescript
{
  id: string;
  officerId: string;
  officerName: string;
  scheduledStatus: 'off-duty' | 'on-duty';
  scheduledTime: string; // ISO 8601
  timezone: string; // IANA timezone
  createdAt: string;
  executedAt?: string;
  cancelledAt?: string;
  status: 'pending' | 'executed' | 'cancelled' | 'failed';
}
```

## Usage

1. **Register an officer**: Fill in the form and click "Register"
2. **Set on duty**: Click the "On" button when an officer starts duty
3. **Schedule off duty**: Click "Schedule Off" button and select desired time
4. **View scheduled tasks**: See all pending and completed tasks in the Scheduled Tasks panel
5. **Cancel schedule**: Click the trash icon on a pending task to cancel

## Supabase Integration

The application now includes full Supabase integration for cloud persistence:

### Features
- **Cloud Storage**: All data stored in PostgreSQL database
- **Real-time Sync**: Live updates across all connected clients
- **Offline Fallback**: Falls back to localStorage when Supabase is not configured
- **Row Level Security**: Secure data access with RLS policies
- **Full-text Search**: Search officers by name, rank, unit, or badge number

### Setup
See [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md) for detailed setup instructions.

### Quick Start
1. Copy `.env.example` to `.env`
2. Add your Supabase URL and anon key
3. Run the schema in [`supabase-schema.sql`](supabase-schema.sql)
4. The app automatically connects to Supabase

### Hooks
- [`useSupabaseOfficers`](src/hooks/use-supabase-officers.ts) - Officer CRUD operations
- [`useSupabaseDutyRecords`](src/hooks/use-supabase-duty-records.ts) - Duty record management
- [`useSupabaseScheduledTasks`](src/hooks/use-supabase-scheduled-tasks.ts) - Scheduled task persistence
- [`useUnifiedData`](src/hooks/use-unified-data.ts) - Combines localStorage + Supabase

## Future Enhancements

- Push notification permissions
- Mobile app with native notifications
- Recurring schedule support
- Admin dashboard for multiple stations
- Authentication and user roles
