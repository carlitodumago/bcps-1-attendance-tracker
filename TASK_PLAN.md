# Implementation Plan

## Goal
Create a download button that exports officer attendance data (since February 2026) to an Excel file.

## Required Steps

1. **Install Excel library** - Use `xlsx` (SheetJS) as it's lightweight and client-side friendly
2. **Create Excel generation utility** - Build a function that:
   - Collects all officers
   - For each officer, retrieves duty records since Feb 1, 2026
   - Creates a structured Excel workbook with sheets:
     - Summary sheet: Officer roster with total stats
     - Daily Attendance sheet: Date, Officer Name, Rank, Unit, Time In, Time Out
3. **Add download button to UI** - Place in the header near stats cards or as separate section
4. **Handle loading state** - Show spinner while processing
5. **Generate filename with current date** - e.g., `attendance-report-2026-04-20.xlsx`

## Code Structure
- Create `src/lib/excelExport.ts` with `generateAttendanceExcel()` function
- Add `DownloadExcelButton` component
- Integrate into `App.tsx` using the `useUnifiedData` hook

## Data Sources
- `officers` - array of AppOfficer
- `dutyRecords` - array of DutyRecord from Supabase
- `getOfficersOnDutyForDate()` - helper for calendar date filtering
