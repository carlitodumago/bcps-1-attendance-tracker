import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { generateAttendanceExcel } from '../lib/excelExport';
import type { AppOfficer } from '../hooks/use-unified-data';
import type { DutyRecord } from '../types/database';

interface DownloadExcelButtonProps {
  officers: AppOfficer[];
  dutyRecords: DutyRecord[];
  variant?: 'default' | 'outline' | 'secondary' | 'destructive';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export const DownloadExcelButton = ({
  officers,
  dutyRecords,
  variant = 'default',
  size = 'default'
}: DownloadExcelButtonProps) => {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleDownload = async () => {
    if (officers.length === 0) {
      toast.warning('No officers available to export');
      return;
    }

    setIsGenerating(true);
    toast.info('Generating Excel report...');

    try {
      const result = generateAttendanceExcel(officers, dutyRecords);

      toast.success(
        `Excel report generated successfully!\n${result.recordCount} duty records exported`
      );
    } catch (error) {
      console.error('Excel export error:', error);
      toast.error('Failed to generate Excel report');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Button
      onClick={handleDownload}
      variant={variant}
      size={size}
      disabled={isGenerating}
      className="bg-green-700 hover:bg-green-800 text-white"
    >
      {isGenerating ? (
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
      ) : (
        <Download className="w-4 h-4 mr-2" />
      )}
      {isGenerating ? 'Generating...' : 'Download Excel Report'}
    </Button>
  );
};
