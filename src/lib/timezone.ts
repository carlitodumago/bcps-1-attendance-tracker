// ============================================================================
// Philippine Time (PHT) Timezone Utility
// All times in this application are stored and displayed in PHT (UTC+8)
// ============================================================================

/**
 * Philippine Time Zone identifier
 */
export const PHT_TIMEZONE = 'Asia/Manila';

/**
 * PHT UTC offset in hours
 */
export const PHT_OFFSET_HOURS = 8;

/**
 * Get current date/time in Philippine Time
 */
export const getNowInPHT = (): Date => {
  const now = new Date();
  return convertToPHT(now);
};

/**
 * Convert any date to Philippine Time
 */
export const convertToPHT = (date: Date): Date => {
  // Get the UTC time in milliseconds
  const utcTime = date.getTime() + (date.getTimezoneOffset() * 60000);
  
  // Create new date with PHT offset (UTC+8)
  const phtTime = new Date(utcTime + (PHT_OFFSET_HOURS * 3600000));
  
  return phtTime;
};

/**
 * Format a date as a time string in PHT (HH:MM:SS format)
 */
export const formatTimeInPHT = (date: Date): string => {
  // Don't call convertToPHT here - the date is already in PHT
  // Calling convertToPHT would cause double conversion
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

/**
 * Format a date as a time string in PHT (12-hour format with AM/PM)
 */
export const formatTimeInPHT12Hour = (date: Date): string => {
  // Don't call convertToPHT here - the date is already in PHT
  // Calling convertToPHT would cause double conversion and show wrong times
  return date.toLocaleTimeString('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: PHT_TIMEZONE,
  });
};

/**
 * Format a date as a date string in PHT (YYYY-MM-DD format)
 */
export const formatDateInPHT = (date: Date): string => {
  const phtDate = convertToPHT(date);
  const year = phtDate.getFullYear();
  const month = String(phtDate.getMonth() + 1).padStart(2, '0');
  const day = String(phtDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Format a date as ISO string in PHT
 * Note: This creates an ISO string representing PHT time, not UTC
 */
export const formatISOInPHT = (date: Date): string => {
  const phtDate = convertToPHT(date);
  const year = phtDate.getFullYear();
  const month = String(phtDate.getMonth() + 1).padStart(2, '0');
  const day = String(phtDate.getDate()).padStart(2, '0');
  const hours = String(phtDate.getHours()).padStart(2, '0');
  const minutes = String(phtDate.getMinutes()).padStart(2, '0');
  const seconds = String(phtDate.getSeconds()).padStart(2, '0');
  const ms = String(phtDate.getMilliseconds()).padStart(3, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}+08:00`;
};

/**
 * Create a Date object from a time string (HH:MM or HH:MM:SS) in PHT
 * The date will be set to today in PHT
 */
export const createTimeInPHT = (timeString: string, baseDate?: Date): Date => {
  const now = baseDate || getNowInPHT();
  const [hours, minutes, seconds = '0'] = timeString.split(':').map(Number);
  
  const phtDate = new Date(now);
  phtDate.setHours(hours, minutes, parseInt(String(seconds), 10), 0);
  
  return phtDate;
};

/**
 * Create a Date object from a date string (YYYY-MM-DD) in PHT
 * The time will be set to 00:00:00 in PHT
 */
export const createDateInPHT = (dateString: string): Date => {
  const [year, month, day] = dateString.split('-').map(Number);
  
  // Create date in PHT (UTC+8)
  const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const phtDate = new Date(utcDate.getTime() - (PHT_OFFSET_HOURS * 3600000));
  
  return phtDate;
};

/**
 * Get tomorrow's date at a specific time in PHT
 */
export const getTomorrowAtTimeInPHT = (timeString: string): Date => {
  const tomorrow = getNowInPHT();
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const [hours, minutes] = timeString.split(':').map(Number);
  tomorrow.setHours(hours, minutes, 0, 0);
  
  return tomorrow;
};

/**
 * Check if a date is today in PHT
 */
export const isTodayInPHT = (date: Date): boolean => {
  const today = getNowInPHT();
  const checkDate = convertToPHT(date);
  
  return (
    today.getFullYear() === checkDate.getFullYear() &&
    today.getMonth() === checkDate.getMonth() &&
    today.getDate() === checkDate.getDate()
  );
};

/**
 * Parse a time string (from database) and return a Date object in PHT
 * Handles both "HH:MM:SS" and "HH:MM:SS.ffffff" formats
 */
export const parseTimeToPHT = (timeStr: string | null, baseDate?: Date): Date | null => {
  if (!timeStr) return null;
  
  const timeParts = timeStr.split(':');
  const hours = parseInt(timeParts[0], 10);
  const minutes = parseInt(timeParts[1], 10);
  const seconds = parseInt(timeParts[2]?.split('.')[0] || '0', 10);
  
  // Use new Date() directly instead of getNowInPHT() to avoid double conversion
  // The time from database is already in PHT, so we just need to set the time components
  const base = baseDate || new Date();
  const phtDate = new Date(base);
  phtDate.setHours(hours, minutes, seconds, 0);
  
  return phtDate;
};

/**
 * Format a time string from database to 12-hour format in PHT
 */
export const formatDatabaseTimeToPHT = (timeStr: string | null): string => {
  if (!timeStr) return '';
  
  const phtDate = parseTimeToPHT(timeStr);
  if (!phtDate) return '';
  
  return formatTimeInPHT12Hour(phtDate);
};

/**
 * Get the current PHT timezone offset string (e.g., "+08:00")
 */
export const getPHTOffsetString = (): string => {
  return '+08:00';
};

/**
 * Convert a UTC ISO string to PHT Date
 */
export const utcISOToPHT = (utcISO: string): Date => {
  const utcDate = new Date(utcISO);
  return convertToPHT(utcDate);
};
