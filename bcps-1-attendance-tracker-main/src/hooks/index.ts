// ============================================================================
// Hooks Index
// Export all hooks for easy importing
// ============================================================================

// Supabase Hooks
export { useSupabaseOfficers } from './use-supabase-officers';
export { useSupabaseDutyRecords } from './use-supabase-duty-records';
export { useSupabaseScheduledTasks } from './use-supabase-scheduled-tasks';

// Unified Hook (combines localStorage + Supabase)
export { useUnifiedData, type AppOfficer } from './use-unified-data';

// Local Storage Hooks (Original)
export { useStatusScheduler } from './use-status-scheduler';

// Utility Hooks
export { useIsMobile } from './use-mobile';
