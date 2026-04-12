# Real-Time Synchronization Implementation

## Overview

This document describes the real-time synchronization implementation for officer record deletion in the BCPS-1 Attendance Tracker application. The system ensures that when an officer record is removed from the backend, all connected clients immediately reflect this change without requiring a page reload or manual refresh.

## Architecture

The real-time synchronization is built on **Supabase Realtime**, which uses WebSocket connections under the hood to provide bidirectional communication between the server and clients.

### Key Components

1. **Supabase Realtime Subscription** (`src/hooks/use-supabase-officers.ts`)
   - Listens for PostgreSQL changes on the `officers` table
   - Handles INSERT, UPDATE, and DELETE events
   - Automatically updates local state when changes occur

2. **Unified Data Hook** (`src/hooks/use-unified-data.ts`)
   - Combines Supabase (cloud) and localStorage (offline) data management
   - Exposes real-time status and callbacks to the UI layer
   - Provides fallback to localStorage when Supabase is unavailable

3. **App Component** (`src/App.tsx`)
   - Displays real-time connection status indicator
   - Subscribes to real-time delete events
   - Shows toast notifications when officers are removed by other users

## Implementation Details

### Real-Time Subscription Setup

The subscription is established in `use-supabase-officers.ts`:

```typescript
subscriptionRef.current = supabase
  .channel('officers_changes')
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'officers' },
    (payload) => {
      if (payload.eventType === 'DELETE') {
        const deletedId = payload.old.id;
        const deletedOfficer = officers.find(o => o.id === deletedId);
        setOfficers(prev => {
          const updated = prev.filter(o => o.id !== deletedId);
          saveToLocalBackup(updated);
          return updated;
        });
        // Notify callback if registered
        if (realtimeDeleteCallbackRef.current && deletedOfficer) {
          realtimeDeleteCallbackRef.current(deletedId, deletedOfficer.name);
        }
      }
      // ... handles INSERT and UPDATE events
    }
  )
  .subscribe();
```

### Delete Flow

1. **User Action**: User clicks the delete button for an officer
2. **Confirmation**: A confirmation dialog appears
3. **Backend Delete**: The `deleteOfficer` function is called, which:
   - Performs optimistic update (removes from UI immediately)
   - Sends DELETE request to Supabase
   - Rolls back on error
4. **Real-Time Broadcast**: Supabase broadcasts the DELETE event to all connected clients
5. **Client Update**: All clients receive the event and:
   - Filter out the deleted officer from their local state
   - Update the local backup
   - Show a toast notification (if the deletion originated from another client)

### Connection Status Indicator

The UI displays a real-time connection status indicator in the Officers List header:

- **Green pulsing dot**: Connected to real-time updates
- **Yellow pulsing dot**: Reconnecting
- **Gray dot**: Disconnected

```typescript
<span
  className={`ml-auto w-2 h-2 rounded-full ${
    realtimeStatus === 'connected'
      ? 'bg-green-500 animate-pulse'
      : realtimeStatus === 'reconnecting'
      ? 'bg-yellow-500 animate-pulse'
      : 'bg-gray-400'
  }`}
  title={`Realtime: ${realtimeStatus}`}
/>
```

### Toast Notifications

When an officer is deleted by another user, a toast notification is displayed:

```typescript
toast.info(`Officer "${officerName}" was removed by another user`, {
  description: 'The officers list has been updated in real-time',
  duration: 5000,
})
```

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Supabase Backend                        │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  PostgreSQL Database (officers table)                    │  │
│  │  - DELETE operation triggers change event                │  │
│  └─────────────────────────────────────────────────────────┘  │
│                           │                                     │
│                           │ Realtime Broadcast                  │
│                           ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  Supabase Realtime Channel                               │  │
│  │  - Broadcasts DELETE event to all subscribers            │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │ Client 1 │    │ Client 2 │    │ Client 3 │
    │          │    │          │    │          │
    │ - Receive│    │ - Receive│    │ - Receive│
    │   DELETE │    │   DELETE │    │   DELETE │
    │   event  │    │   event  │    │   event  │
    │          │    │          │    │          │
    │ - Update │    │ - Update │    │ - Update │
    │   local  │    │   local  │    │   local  │
    │   state  │    │   state  │    │   state  │
    │          │    │          │    │          │
    │ - Show   │    │ - Show   │    │ - Show   │
    │   toast  │    │   toast  │    │   toast  │
    └──────────┘    └──────────┘    └──────────┘
```

## Error Handling

The implementation includes robust error handling:

1. **Network Failures**: Automatic retry with exponential backoff
2. **Connection Loss**: Fallback to localStorage for offline functionality
3. **Rollback on Error**: Optimistic updates are rolled back if the backend operation fails
4. **Duplicate Prevention**: Checks for duplicate entries when receiving real-time events

## Testing

To test the real-time synchronization:

1. Open the application in two different browser windows/tabs
2. Delete an officer from one window
3. Observe that:
   - The officer is immediately removed from the list in both windows
   - A toast notification appears in the window where the deletion was performed
   - A different toast notification appears in the other window indicating the deletion was made by another user
   - The real-time status indicator remains green (connected)

## Performance Considerations

1. **Optimistic Updates**: UI updates immediately, providing instant feedback
2. **Local Backup**: Data is saved to localStorage for offline access and faster loading
3. **Efficient Filtering**: Only the deleted officer is removed from the state, not the entire list
4. **Debounced Updates**: State updates are batched to prevent excessive re-renders

## Security

1. **Row Level Security (RLS)**: Supabase RLS policies ensure users can only access authorized data
2. **Authentication**: Real-time subscriptions require valid authentication
3. **Validation**: All data is validated on both client and server sides

## Future Enhancements

Potential improvements for the real-time synchronization:

1. **Conflict Resolution**: Handle concurrent edits to the same record
2. **Presence Indicators**: Show which users are currently viewing the application
3. **Activity Log**: Maintain a log of all real-time changes for audit purposes
4. **Selective Subscriptions**: Subscribe only to specific records or events to reduce bandwidth
5. **Compression**: Enable message compression for large payloads

## Troubleshooting

### Real-time updates not working

1. Check the real-time status indicator (should be green)
2. Verify Supabase environment variables are set correctly
3. Check browser console for WebSocket connection errors
4. Ensure RLS policies allow real-time subscriptions

### Toast notifications not appearing

1. Verify the `onRealtimeDelete` callback is properly registered
2. Check that the toast library is properly initialized
3. Ensure the component is mounted when the event is received

### Data not persisting

1. Check localStorage availability and quota
2. Verify Supabase connection is active
3. Review browser console for save/load errors

## References

- [Supabase Realtime Documentation](https://supabase.com/docs/guides/realtime)
- [PostgreSQL Change Data Capture](https://www.postgresql.org/docs/current/logical-replication.html)
- [WebSocket Protocol](https://tools.ietf.org/html/rfc6455)
