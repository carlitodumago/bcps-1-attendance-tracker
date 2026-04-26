import * as XLSX from 'xlsx';
import type { Officer, DutyRecord } from '../types/database';

/**
 * Exports officers with duty records from February 2026 onwards to Excel
 */
export const exportOfficersToExcel = (officers: Officer[], dutyRecords: DutyRecord[]) => {
  // Create worksheet data with all duty records
  const worksheetData = officers.map(officer => {
    const officerDutyRecords = dutyRecords.filter(
      record => record.officer_id === officer.id
    );
    
    const totalDutyDays = officerDutyRecords.length;
    const lastDutyDate = officerDutyRecords.length > 0 
      ? new Date(Math.max(...officerDutyRecords.map(r => new Date(r.duty_date).getTime()))).toLocaleDateString()
      : 'No records';

    return {
      'ID': officer.id,
      'Name': officer.name,
      'Rank': officer.rank,
      'Badge Number': officer.badge_number || 'N/A',
      'Unit': officer.unit,
      'Current Status': officer.current_status === 'on-duty' ? 'On Duty' : 'Off Duty',
      'Duty Days (Feb 2026+)': totalDutyDays,
      'Last Duty Date': lastDutyDate,
      'Created Date': new Date(officer.created_at).toLocaleDateString()
    };
  });

  // Create worksheet and workbook
  const worksheet = XLSX.utils.json_to_sheet(worksheetData);
  const workbook = XLSX.utils.book_new();
  
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Officers');

  // Set column widths
  worksheet['!cols'] = [
    { wch: 10 }, // ID
    { wch: 25 }, // Name
    { wch: 10 }, // Rank
    { wch: 15 }, // Badge Number
    { wch: 15 }, // Unit
    { wch: 15 }, // Current Status
    { wch: 20 }, // Duty Days
    { wch: 15 }, // Last Duty Date
    { wch: 15 }  // Created Date
  ];

  // Generate file and trigger download
  XLSX.writeFile(workbook, `BCPS1_Officer_Duties_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
};