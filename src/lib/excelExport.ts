import * as XLSX from 'xlsx';
import type { AppOfficer } from '../hooks/use-unified-data';
import type { DutyRecord } from '../types/database';
import { formatDatabaseTimeToPHT } from '../lib/timezone';
import { format } from 'date-fns';

interface ExportRow {
  Date: string;
  OfficerName: string;
  Rank: string;
  BadgeNumber: string;
  Unit: string;
  TimeIn: string;
  TimeOut: string;
}

export const generateAttendanceExcel = (
  officers: AppOfficer[],
  dutyRecords: DutyRecord[],
  startDate: Date = new Date('2026-02-16'),
  endDate: Date = new Date()
) => {
  // Filter duty records from February 2026 to present
  const startDateStr = format(startDate, 'yyyy-MM-dd');
  const endDateStr = format(endDate, 'yyyy-MM-dd');

  const filteredRecords = dutyRecords.filter(record =>
    record.duty_date >= startDateStr && record.duty_date <= endDateStr
  );

  // Precompute last duty date for each officer from all their records (for reference if needed)
  // const officerLastDutyMap = new Map<string, string>();
  // officers.forEach(officer => {
  //   const officerRecords = dutyRecords.filter(r => r.officer_id === officer.id);
  //   if (officerRecords.length > 0) {
  //     const lastDate = new Date(Math.max(...officerRecords.map(r => new Date(r.duty_date).getTime()))).toLocaleDateString();
  //     officerLastDutyMap.set(officer.id, lastDate);
  //   } else {
  //     officerLastDutyMap.set(officer.id, 'No records');
  //   }
  // });

  // Prepare export data
  const exportData: ExportRow[] = [];

  filteredRecords.forEach(record => {
    const officer = officers.find(o => o.id === record.officer_id);
    if (!officer) return;

    exportData.push({
      Date: record.duty_date,
      OfficerName: officer.name,
      Rank: officer.rank,
      BadgeNumber: officer.badgeNumber || '',
      Unit: officer.unit,
      TimeIn: formatDatabaseTimeToPHT(record.time_in) || 'Not Recorded',
      TimeOut: formatDatabaseTimeToPHT(record.time_out) || 'On Duty'
    });
  });

  // Sort by date descending
  exportData.sort((a, b) => b.Date.localeCompare(a.Date));

  // Create workbook and worksheet
  const wb = XLSX.utils.book_new();

  // Daily Attendance Sheet
  const attendanceSheet = XLSX.utils.json_to_sheet(exportData);
  XLSX.utils.book_append_sheet(wb, attendanceSheet, 'Duty Schedule');

  // Generate filename with current date
  const fileName = `bcps-1-duty-schedule-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;

  // Write and download
  XLSX.writeFile(wb, fileName);

  // Set column widths for better readability (7 columns)
  attendanceSheet['!cols'] = [
    { wch: 12 }, // Date
    { wch: 25 }, // OfficerName
    { wch: 10 }, // Rank
    { wch: 15 }, // BadgeNumber
    { wch: 15 }, // Unit
    { wch: 12 }, // TimeIn
    { wch: 12 }  // TimeOut
  ];

  return {
    fileName,
    recordCount: exportData.length
  };
};
