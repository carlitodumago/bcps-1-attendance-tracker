// ============================================================================
// App Settings Hook — persists key/value UI preferences to Supabase + localStorage
// Falls back gracefully to localStorage when Supabase is unavailable
// ============================================================================

import { useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

const LS_PREFIX = 'bcps-1-';

/**
 * Load a setting: Supabase first, then localStorage fallback.
 */
export const loadSetting = async (key: string): Promise<string | null> => {
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();
      if (!error && data) return data.value;
    } catch { /* fall through to localStorage */ }
  }
  return localStorage.getItem(`${LS_PREFIX}${key}`);
};

/**
 * Persist a setting: always writes to localStorage, attempts Supabase upsert.
 */
export const saveSetting = async (key: string, value: string): Promise<void> => {
  // Always persist locally first (instant, offline-safe)
  localStorage.setItem(`${LS_PREFIX}${key}`, value);

  if (!isSupabaseConfigured()) return;
  try {
    await supabase
      .from('app_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  } catch (err) {
    console.warn('Failed to persist setting to Supabase, localStorage retained:', err);
  }
};

/**
 * Hook exposing load/save helpers bound to a specific key.
 */
export function useAppSetting(key: string) {
  const load = useCallback(() => loadSetting(key), [key]);
  const save = useCallback((value: string) => saveSetting(key, value), [key]);
  return { load, save };
}
