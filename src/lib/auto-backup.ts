import { get, set } from 'idb-keyval';
import type { AppOfficer } from '../hooks/use-unified-data';
import type { DutyRecord } from '../types/database';
import { supabase, isSupabaseConfigured } from './supabase';

export const BACKUP_HISTORY_KEY = 'bcps-1-backup-history';

export interface BackupSnapshot {
  id: string;
  timestamp: string;
  officers: AppOfficer[];
  dutyRecords: DutyRecord[];
  type: 'auto' | 'manual';
}

export const saveSilentBackup = async (officers: AppOfficer[], dutyRecords: DutyRecord[]): Promise<void> => {
  if (officers.length === 0) return; // Don't backup empty state

  try {
    const today = new Date().toDateString();
    let history: BackupSnapshot[] = await get(BACKUP_HISTORY_KEY) || [];
    
    // Check if we already have an auto-backup for today
    const hasTodayBackup = history.some(b => 
      b.type === 'auto' && new Date(b.timestamp).toDateString() === today
    );

    if (hasTodayBackup) return;

    const snapshot: BackupSnapshot = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      officers,
      dutyRecords,
      type: 'auto'
    };
    
    history.push(snapshot);
    
    // Keep only the last 30 backups to prevent infinite growth
    if (history.length > 30) {
      history = history.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 30);
    }
    
    await set(BACKUP_HISTORY_KEY, history);
    console.log('Silent auto-backup saved to IndexedDB successfully.');
  } catch (error) {
    console.error('Failed to create auto backup in IndexedDB', error);
  }
};

export const getBackupHistory = async (): Promise<BackupSnapshot[]> => {
  try {
    const history: BackupSnapshot[] = await get(BACKUP_HISTORY_KEY) || [];
    return history.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  } catch (error) {
    console.error('Failed to retrieve backup history', error);
    return [];
  }
};

export const createManualSnapshot = async (officers: AppOfficer[], dutyRecords: DutyRecord[]): Promise<void> => {
  try {
    let history: BackupSnapshot[] = await get(BACKUP_HISTORY_KEY) || [];
    
    const snapshot: BackupSnapshot = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      officers,
      dutyRecords,
      type: 'manual'
    };
    
    history.push(snapshot);
    await set(BACKUP_HISTORY_KEY, history);
  } catch (error) {
    console.error('Failed to create manual snapshot', error);
  }
};

export const optimizeDatabase = async (): Promise<void> => {
  if (!isSupabaseConfigured()) return;
  try {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 4);
    const dateStr = cutoff.toISOString().split('T')[0];
    
    // Delete duty records older than 4 months
    await supabase.from('duty_records').delete().lt('duty_date', dateStr);
    
    // Delete scheduled tasks older than 4 months
    await supabase.from('scheduled_tasks').delete().lt('scheduled_time', dateStr);
    
    console.log('Database optimization complete. Purged records older than 4 months to free storage.');
  } catch (error) {
    console.error('Failed to optimize database', error);
  }
};
