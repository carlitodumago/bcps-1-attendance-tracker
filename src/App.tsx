import { useState, useEffect, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Shield,
  UserCheck,
  UserX,
  UserPlus,
  Trash2,
  Edit2,
  Search,
  Calendar as CalendarIcon,
  MapPin,
  Phone,
  Users,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Clock,
  Timer,
  Download,
  Upload,
  Eye,
  EyeOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { generateAttendanceExcel } from './lib/excelExport'
import { supabase, isSupabaseConfigured } from './lib/supabase'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
} from 'date-fns'

// Removed time-utils import - using native Date() and date-fns
// getCurrentTime -> new Date()
// getTomorrowAtTime(timeStr) -> custom inline
// formatDbTime -> native formatting

// Scheduler imports
import { useUnifiedData, type AppOfficer } from './hooks/use-unified-data'
import { ScheduleOffDutyButton } from './components/ScheduleOffDutyButton'

// Type for editing officer
interface EditingOfficer {
  id: string
  name: string
  rank: string
  badgeNumber?: string
  unit: string
}

function App() {
  // Use unified data hook (handles both Supabase and localStorage)
  const {
    officers,
    dutyRecords,
    deleteDutyRecord,
    updateDutyRecord,
    addDutyRecord,
    loading,
    realtimeStatus,
    addOfficer,
    updateOfficer,
    deleteOfficer,
    checkInOfficer,
    checkOutOfficer,
    scheduleTask,
    cancelTask,
    getTaskForOfficer,
    refreshData,
  } = useUnifiedData()

  // Form state
  const [name, setName] = useState('')
  const [rank, setRank] = useState('')
  const [badgeNumber, setBadgeNumber] = useState('')
  const [unit, setUnit] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminVerified, setAdminVerified] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [editingOfficer, setEditingOfficer] = useState<EditingOfficer | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [officerToDelete, setOfficerToDelete] = useState<string | null>(null)
  const [deleteDutyDialog, setDeleteDutyDialog] = useState<{ open: boolean; dutyRecordId: string }>(
    { open: false, dutyRecordId: '' },
  )
  const [editDutyDialog, setEditDutyDialog] = useState<{ open: boolean; dutyRecordId: string; currentOfficerId: string }>(
    { open: false, dutyRecordId: '', currentOfficerId: '' },
  )

  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [dayDetailsOpen, setDayDetailsOpen] = useState(false)
  const [assignDialogOpen, setAssignDialogOpen] = useState(false)
  const [selectedOfficerId, setSelectedOfficerId] = useState<string>('')

  // Schedule Off-Duty state
  const [scheduleTime, setScheduleTime] = useState<string>('08:00')
  const [isSchedulePopoverOpen, setIsSchedulePopoverOpen] = useState(false)

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const OFFICERS_PER_PAGE = 5

  // Reset pagination when search changes
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm])

  // Refresh data when component mounts
  useEffect(() => {
    refreshData()
  }, [refreshData])

  // Handle add officer
  const handleAddOfficer = async () => {
    if (!name.trim()) {
      toast.error('Please enter officer name')
      return
    }
    if (!rank.trim()) {
      toast.error('Please enter rank')
      return
    }

    try {
      await addOfficer(name.trim(), rank.trim(), badgeNumber.trim(), unit.trim())
      setName('')
      setRank('')
      setBadgeNumber('')
      setUnit('')
      toast.success('Officer registered successfully')
    } catch {
      toast.error('Failed to register officer')
    }
  }

  // Handle on duty
  const handleOnDuty = async (officerId: string) => {
    const officer = officers.find((o) => o.id === officerId)
    if (!officer) return

    if (officer.currentStatus === 'on-duty') {
      toast.info(`${officer.name} is already ON DUTY`)
      return
    }

    try {
      await checkInOfficer(officerId)

      // Automatically schedule off-duty for tomorrow at 8:00 AM
      const tomorrow = (() => {
        const now = new Date()
        const phTime = new Date(now.toLocaleString('en-PH', { timeZone: 'Asia/Manila' }))
        phTime.setDate(phTime.getDate() + 1)
        phTime.setHours(8, 0, 0, 0)
        return phTime
      })()

      await scheduleTask(officerId, officer.name, 'off-duty', tomorrow)

      toast.success(`${officer.name} is now ON DUTY`, {
        description: 'Auto-scheduled off-duty for tomorrow at 8:00 AM',
      })
    } catch {
      toast.error('Failed to check in officer')
    }
  }

  // Handle off duty
  const handleOffDuty = async (officerId: string) => {
    const officer = officers.find((o) => o.id === officerId)
    if (!officer) return

    if (officer.currentStatus === 'off-duty') {
      toast.info(`${officer.name} is already OFF DUTY`)
      return
    }

    console.log('handleOffDuty called for:', officerId)
    try {
      const result = await checkOutOfficer(officerId)
      console.log('checkOutOfficer result:', result)
      if (result) {
        toast.success(`${officer.name} is now OFF DUTY`)
      } else {
        toast.error('Failed to check out officer')
      }
    } catch (error) {
      console.error('handleOffDuty error:', error)
      toast.error('Failed to check out officer')
    }
  }

  // Handle delete
  const handleDelete = (officerId: string) => {
    setOfficerToDelete(officerId)
    setDeleteDialogOpen(true)
  }

  // Confirm delete
  const confirmDelete = async () => {
    if (officerToDelete) {
      try {
        await deleteOfficer(officerToDelete)
        toast.success('Officer removed from logbook')
        setDeleteDialogOpen(false)
        setOfficerToDelete(null)
      } catch {
        toast.error('Failed to remove officer')
      }
    }
  }

  // Handle edit
  const handleEdit = (officer: AppOfficer) => {
    setEditingOfficer({
      id: officer.id,
      name: officer.name,
      rank: officer.rank,
      badgeNumber: officer.badgeNumber,
      unit: officer.unit,
    })
  }

  // Save edit
  const saveEdit = async () => {
    if (editingOfficer) {
      if (!editingOfficer.name.trim()) {
        toast.error('Name cannot be empty')
        return
      }
      if (!editingOfficer.rank.trim()) {
        toast.error('Rank cannot be empty')
        return
      }
      try {
        await updateOfficer(editingOfficer.id, {
          name: editingOfficer.name.trim(),
          rank: editingOfficer.rank.trim(),
          badgeNumber: editingOfficer.badgeNumber?.trim(),
          unit: editingOfficer.unit.trim(),
        })
        setEditingOfficer(null)
        toast.success('Officer information updated')
      } catch {
        toast.error('Failed to update officer')
      }
    }
  }

  // Get officers on duty for a specific date
  const getOfficersOnDutyForDate = (date: Date): AppOfficer[] => {
    const dateStr = format(date, 'yyyy-MM-dd')

    // Use Supabase duty records if available
    if (dutyRecords && dutyRecords.length > 0) {
      const officerIdsOnDuty = dutyRecords
        .filter((record) => record.duty_date === dateStr)
        .map((record) => record.officer_id)
      return officers.filter((officer) => officerIdsOnDuty.includes(officer.id))
    }

    // Fallback to local duty history
    return officers.filter((officer) =>
      officer.dutyHistory?.some((record) => record.date === dateStr),
    )
  }

  // Calendar generation
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth)
    const monthEnd = endOfMonth(monthStart)
    const calendarStart = startOfWeek(monthStart)
    const calendarEnd = endOfWeek(monthEnd)

    const days = []
    let day = calendarStart

    while (day <= calendarEnd) {
      days.push(day)
      day = addDays(day, 1)
    }

    return days
  }, [currentMonth])

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const handleDateClick = (date: Date) => {
    setSelectedDate(date)
    const officersOnDuty = getOfficersOnDutyForDate(date)
    if (officersOnDuty.length > 0) {
      setDayDetailsOpen(true)
    } else {
      setAssignDialogOpen(true)
    }
  }

  const onDutyOfficers = officers.filter((o) => o.currentStatus === 'on-duty')
  const offDutyOfficers = officers.filter((o) => o.currentStatus === 'off-duty')

  const handleScheduleAllOffDuty = useCallback(async () => {
    const scheduledTime = (() => {
      const [hours, minutes] = scheduleTime.split(':').map(Number)
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(hours, minutes, 0, 0)
      return tomorrow
    })()

    const now = new Date()

    if (scheduledTime <= now) {
      toast.error('Selected time has already passed')
      return
    }

    if (onDutyOfficers.length === 0) {
      toast.error('No officers are currently on duty')
      return
    }

    // Schedule off-duty for all on-duty officers
    for (const officer of onDutyOfficers) {
      await scheduleTask(officer.id, officer.name, 'off-duty', scheduledTime)
    }

    const timeLabel = new Date(`2000-01-01T${scheduleTime}`).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })

    toast.success(
      `Scheduled ${onDutyOfficers.length} officer${onDutyOfficers.length > 1 ? 's' : ''} to go off-duty tomorrow at ${timeLabel}`,
    )
    setIsSchedulePopoverOpen(false)
  }, [onDutyOfficers, scheduleTime, scheduleTask])

  const filteredOfficers = officers.filter(
    (officer) =>
      (officer.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (officer.rank || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (officer.unit || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (officer.badgeNumber || '').toLowerCase().includes(searchTerm.toLowerCase()),
  )

  const totalPages = Math.ceil(filteredOfficers.length / OFFICERS_PER_PAGE)
  const paginatedOfficers = filteredOfficers.slice(
    (currentPage - 1) * OFFICERS_PER_PAGE,
    currentPage * OFFICERS_PER_PAGE
  )

  // Helper to format Supabase time (HH:MM:SS) to 12-hour format - times stored as UTC, add 8 for PH display
  const formatTime = (timeStr: string | null | undefined) => {
    if (!timeStr) return ''
    const [hours, minutes] = timeStr.split(':').map(Number)
    // Add 8 hours for Philippine timezone
    const adjustedHours = (hours + 8) % 24
    const hour12 = adjustedHours % 12 || 12
    const ampm = adjustedHours >= 12 ? 'PM' : 'AM'
    return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`
  }

  // Get countdown for a scheduled task
  const getCountdown = (scheduledTime: string) => {
    const now = new Date()
    const scheduled = new Date(scheduledTime)
    const diff = scheduled.getTime() - now.getTime()

    if (diff <= 0) {
      return {
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        totalMilliseconds: 0,
        isExpired: true,
      }
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    const seconds = Math.floor((diff % (1000 * 60)) / 1000)

    return {
      days,
      hours,
      minutes,
      seconds,
      totalMilliseconds: diff,
      isExpired: false,
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50">
      <Toaster position="top-right" richColors />

      {/* Header */}
      <header className="bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 text-white shadow-lg">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-center gap-4">
            <img
              src="/pnp_logo_nobg.png"
              alt="Philippine National Police"
              className="h-16 md:h-20 object-contain"
            />
            <div className="text-center">
              <h1 className="text-2xl md:text-3xl font-bold tracking-wide">
                BCPS-1 Traffic Section Attendance Tracker
              </h1>
            </div>
            <img
              src="/butuan_ps1_nobg.png"
              alt="Butuan City Police Station 1"
              className="h-16 md:h-20 object-contain"
            />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <Card className="bg-gradient-to-r from-green-500 to-green-600 text-white border-0 shadow-lg">
            <CardContent className="p-6 flex items-center justify-between">
              <div>
                <p className="text-green-100 text-sm font-medium">ON DUTY NOW</p>
                <p className="text-4xl font-bold">{onDutyOfficers.length}</p>
              </div>
              <div className="bg-white/20 p-4 rounded-full">
                <UserCheck className="w-8 h-8" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-r from-gray-500 to-gray-600 text-white border-0 shadow-lg">
            <CardContent className="p-6 flex items-center justify-between">
              <div>
                <p className="text-gray-100 text-sm font-medium">OFF DUTY</p>
                <p className="text-4xl font-bold">{offDutyOfficers.length}</p>
              </div>
              <div className="bg-white/20 p-4 rounded-full">
                <UserX className="w-8 h-8" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Export & Backup Buttons */}
        <div className="flex justify-end gap-2 mb-4">
          <input
            type="file"
            accept=".json"
            id="backup-upload"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;

              try {
                const text = await file.text();
                const data = JSON.parse(text);
                
                if (!data.officers || !Array.isArray(data.officers) || !data.dutyRecords || !Array.isArray(data.dutyRecords)) {
                  toast.error('Invalid backup file format');
                  return;
                }

                toast.info('Restoring backup... Please wait.');

                if (isSupabaseConfigured()) {
                  // Map AppOfficer back to DB Officer format
                  const dbOfficers = data.officers.map((o: any) => ({
                    id: o.id,
                    name: o.name,
                    rank: o.rank,
                    badge_number: o.badgeNumber || null,
                    unit: o.unit || 'Unassigned',
                    current_status: o.currentStatus || 'off-duty',
                  }));

                  // 1. Insert officers (upsert to handle existing)
                  if (dbOfficers.length > 0) {
                    const { error: offErr } = await supabase.from('officers').upsert(dbOfficers);
                    if (offErr) throw new Error(`Officers restore failed: ${offErr.message}`);
                  }

                  // 2. Insert duty records (upsert to handle existing)
                  if (data.dutyRecords.length > 0) {
                    const { error: dutyErr } = await supabase.from('duty_records').upsert(data.dutyRecords);
                    if (dutyErr) throw new Error(`Duty records restore failed: ${dutyErr.message}`);
                  }
                  
                  toast.success(`Successfully restored ${dbOfficers.length} officers and ${data.dutyRecords.length} records to Supabase!`);
                  refreshData();
                } else {
                  // Offline mode fallback: restore directly to local storage
                  localStorage.setItem('bcsp-1-attendance-tracker', JSON.stringify(data.officers));
                  localStorage.setItem('bcps-1-duty-records-backup', JSON.stringify(data.dutyRecords));
                  toast.success(`Restored ${data.officers.length} officers in Offline Mode!`);
                  
                  // Reload page to apply local storage changes instantly
                  setTimeout(() => {
                    window.location.reload();
                  }, 1500);
                }
              } catch (error: any) {
                console.error('Restore error:', error);
                toast.error(error.message || 'Failed to restore backup');
              }
              
              // Reset input
              e.target.value = '';
            }}
          />
          <Button
            onClick={() => document.getElementById('backup-upload')?.click()}
            variant="outline"
            className="border-purple-600 text-purple-600 hover:bg-purple-50"
          >
            <Upload className="w-4 h-4 mr-2" />
            Restore Backup
          </Button>
          <Button
            onClick={() => {
              try {
                const backup = {
                  officers,
                  dutyRecords,
                  timestamp: new Date().toISOString()
                };
                const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `bcps1-attendance-backup-${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                toast.success('Backup downloaded successfully!');
              } catch (error) {
                console.error('Backup error:', error);
                toast.error('Failed to create backup');
              }
            }}
            variant="outline"
            className="border-blue-600 text-blue-600 hover:bg-blue-50"
          >
            <Download className="w-4 h-4 mr-2" />
            Backup Data (JSON)
          </Button>
          <Button
            onClick={() => {
              try {
                const result = generateAttendanceExcel(officers, dutyRecords);
                toast.success(`Excel report generated!\n${result.recordCount} duty records exported`);
              } catch (error) {
                console.error('Excel export error:', error);
                toast.error('Failed to generate Excel report');
              }
            }}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            <Download className="w-4 h-4 mr-2" />
            Export to Excel
          </Button>
        </div>

        <Card className="bg-gradient-to-r from-blue-500 to-blue-600 text-white border-0 shadow-lg">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm font-medium">TOTAL OFFICERS</p>
              <p className="text-4xl font-bold">{officers.length}</p>
            </div>
            <div className="bg-white/20 p-4 rounded-full">
              <Users className="w-8 h-8" />
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column - Officer Management */}
          <div className="space-y-6">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                type="search"
                autoComplete="off"
                placeholder="Search officers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 border-gray-200 h-9 text-sm"
              />
            </div>

            {/* Admin Access */}
            {!adminVerified && (
              <Card className="border-2 border-blue-200 shadow-xl bg-white">
                <CardHeader className="bg-blue-50 border-b border-blue-200 py-3">
                  <CardTitle className="flex items-center gap-2 text-blue-900 text-base">
                    <Shield className="w-4 h-4" />
                    Admin Access Required
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="space-y-3">
                    <label className="text-xs font-medium text-gray-700">Enter Admin Password to Register Officers</label>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder="Enter password"
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        className="border-red-200 h-9 text-sm pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <Button
                      onClick={() => {
                        if (adminPassword === 'bcps1') {
                          setAdminVerified(true)
                          toast.success('Admin access granted')
                        } else {
                          setAdminPassword('')
                          toast.error('Incorrect password')
                        }
                      }}
                      size="sm"
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      Submit Password
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Add Officer Card */}
            {adminVerified && (
              <Card className="border-2 border-blue-100 shadow-xl bg-white/80 backdrop-blur">
              <CardHeader className="bg-gradient-to-r from-blue-50 to-white border-b border-blue-100 py-3">
                <CardTitle className="flex items-center gap-2 text-blue-900 text-base">
                  <UserPlus className="w-4 h-4" />
                  Register New Officer
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-700">Full Name *</label>
                    <Input
                      placeholder="Enter name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="border-blue-200 h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-700">Rank *</label>
                    <Input
                      placeholder="e.g., PO1"
                      value={rank}
                      onChange={(e) => setRank(e.target.value)}
                      className="border-blue-200 h-9 text-sm"
                    />
                   </div>
                   <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-700">Unit</label>
                    <Input
                      placeholder="e.g., Station 1"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      className="border-blue-200 h-9 text-sm"
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-700">Badge #</label>
                    <Input
                      placeholder="e.g., 12345"
                      value={badgeNumber}
                      onChange={(e) => setBadgeNumber(e.target.value)}
                      className="border-blue-200 h-9 text-sm"
                    />
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button
                    onClick={handleAddOfficer}
                    size="sm"
                    className="bg-blue-700 hover:bg-blue-800 text-white"
                    disabled={loading}
                  >
                    <UserPlus className="w-4 h-4 mr-1" />
                    Register
                  </Button>
                </div>
              </CardContent>
            </Card>
            )}

            {/* Officer List */}
            <Card className="border-2 border-gray-100 shadow-xl bg-white/80 backdrop-blur">
              <CardHeader className="bg-gradient-to-r from-gray-50 to-white border-b border-gray-100 py-3">
                <CardTitle className="flex items-center gap-2 text-gray-700 text-base">
                  <Users className="w-4 h-4" />
                  Officers List
                  <Badge variant="secondary" className="ml-2 text-xs">
                    {filteredOfficers.length}
                  </Badge>
                  {/* Realtime Status Indicator */}
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
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {filteredOfficers.length === 0 ? (
                  <div className="p-6 text-center text-gray-500">
                    <Users className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                    <p className="text-sm">No officers registered</p>
                  </div>
                ) : (
                  <div className="flex flex-col h-full">
                    <div className="divide-y divide-gray-100 overflow-y-auto" style={{ minHeight: '340px' }}>
                      {paginatedOfficers.map((officer) => (
                        <div key={officer.id} className="p-3 hover:bg-gray-50">
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm truncate">{officer.name}</span>
                                {officer.currentStatus === 'on-duty' ? (
                                  <Badge className="bg-green-500 text-white text-xs">On Duty</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-gray-500 text-xs">
                                    Off Duty
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {officer.rank} {officer.badgeNumber && `• #${officer.badgeNumber}`}{' '}
                                {officer.unit && `• ${officer.unit}`}
                              </div>
                            </div>
                             <div className="flex gap-1 ml-2">
                               <Button
                                 size="sm"
                                 onClick={() => handleOnDuty(officer.id)}
                                 className="bg-green-600 hover:bg-green-700 text-white h-7 px-2 text-xs"
                               >
                                 <UserCheck className="w-3 h-3 mr-1" />
                                 On
                               </Button>
                               <Button
                                 size="sm"
                                 onClick={() => handleOffDuty(officer.id)}
                                 variant="outline"
                                 className="border-orange-400 text-orange-600 hover:bg-orange-50 h-7 px-2 text-xs"
                               >
                                 <UserX className="w-3 h-3 mr-1" />
                                 Off
                               </Button>
                               {officer.currentStatus === 'on-duty' && (
                                 <ScheduleOffDutyButton
                                   officerId={officer.id}
                                   officerName={officer.name}
                                   currentStatus={officer.currentStatus}
                                   scheduledTask={getTaskForOfficer(officer.id)}
                                   onSchedule={scheduleTask}
                                   onCancelSchedule={cancelTask}
                                   getCountdown={getCountdown}
                                   compact
                                 />
                               )}
                               <Button
                                 size="sm"
                                 variant="ghost"
                                 onClick={() => handleEdit(officer)}
                                 className="text-blue-600 hover:bg-blue-50 h-7 w-7 p-0"
                               >
                                 <Edit2 className="w-3 h-3" />
                               </Button>
                               <Button
                                 size="sm"
                                 variant="ghost"
                                 onClick={() => handleDelete(officer.id)}
                                 className="text-red-600 hover:bg-red-50 h-7 w-7 p-0"
                               >
                                 <Trash2 className="w-3 h-3" />
                               </Button>
                             </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between p-3 border-t border-gray-100 bg-gray-50/50">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                          className="h-8 text-xs"
                        >
                          <ChevronLeft className="w-4 h-4 mr-1" />
                          Prev
                        </Button>
                        <span className="text-xs text-gray-500 font-medium">
                          Page {currentPage} of {totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                          disabled={currentPage === totalPages}
                          className="h-8 text-xs"
                        >
                          Next
                          <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Calendar & Scheduled Tasks */}
          <div className="space-y-6">
            {/* Duty Calendar with Scheduled Off-Duty */}
            <Card className="border-2 border-blue-100 shadow-xl bg-white/80 backdrop-blur">
              <CardHeader className="bg-gradient-to-r from-blue-50 to-white border-b border-blue-100">
                <CardTitle className="flex items-center justify-between text-blue-900">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="w-5 h-5" />
                    Duty Calendar
                  </div>
                  <div className="flex items-center gap-2">
                    {onDutyOfficers.length > 0 && (
                      <Popover open={isSchedulePopoverOpen} onOpenChange={setIsSchedulePopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-orange-400 text-orange-600 hover:bg-orange-50 h-8 px-2 text-xs"
                            title="Schedule off-duty for all on-duty officers"
                          >
                            <Timer className="w-3 h-3 mr-1" />
                            Schedule Off-Duty
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72" align="end">
                          <div className="space-y-4">
                            <div>
                              <h4 className="font-semibold text-sm">Schedule Off-Duty</h4>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Schedule all {onDutyOfficers.length} on-duty officer
                                {onDutyOfficers.length > 1 ? 's' : ''} for tomorrow
                              </p>
                            </div>

                            <div className="space-y-2">
                              <label className="text-xs font-medium text-gray-700">
                                Select Time (Default: 8:00 AM)
                              </label>
                              <Select value={scheduleTime} onValueChange={setScheduleTime}>
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select time" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="06:00">6:00 AM</SelectItem>
                                  <SelectItem value="07:00">7:00 AM</SelectItem>
                                  <SelectItem value="08:00">8:00 AM (Default)</SelectItem>
                                  <SelectItem value="09:00">9:00 AM</SelectItem>
                                  <SelectItem value="10:00">10:00 AM</SelectItem>
                                  <SelectItem value="14:00">2:00 PM</SelectItem>
                                  <SelectItem value="15:00">3:00 PM</SelectItem>
                                  <SelectItem value="16:00">4:00 PM</SelectItem>
                                  <SelectItem value="17:00">5:00 PM</SelectItem>
                                  <SelectItem value="18:00">6:00 PM</SelectItem>
                                  <SelectItem value="20:00">8:00 PM</SelectItem>
                                  <SelectItem value="22:00">10:00 PM</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <Button
                              onClick={handleScheduleAllOffDuty}
                              className="w-full bg-orange-500 hover:bg-orange-600"
                            >
                              <Timer className="w-4 h-4 mr-2" />
                              Schedule All Off-Duty
                            </Button>

                            <p className="text-xs text-muted-foreground text-center">
                              All {onDutyOfficers.length} on-duty officer
                              {onDutyOfficers.length > 1 ? 's' : ''} will automatically go off-duty
                              tomorrow at the selected time.
                            </p>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {/* Calendar Header */}
                <div className="flex items-center justify-between mb-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <h3 className="text-lg font-semibold text-blue-900">
                    {format(currentMonth, 'MMMM yyyy')}
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>

                {/* Week Days Header */}
                <div className="grid grid-cols-7 gap-1 mb-2">
                  {weekDays.map((day) => (
                    <div key={day} className="text-center text-sm font-semibold text-gray-600 py-2">
                      {day}
                    </div>
                  ))}
                </div>

                {/* Calendar Grid */}
                <div className="grid grid-cols-7 gap-1">
                  {calendarDays.map((day, idx) => {
                    const isCurrentMonth = isSameMonth(day, currentMonth)
                    const isToday = isSameDay(day, new Date())
                    const officersOnDuty = getOfficersOnDutyForDate(day)
                    const hasOfficers = officersOnDuty.length > 0

                    return (
                      <button
                        key={idx}
                        onClick={() => handleDateClick(day)}
                        className={`
                            relative aspect-square p-2 rounded-lg border transition-all hover:scale-105
                            ${isCurrentMonth ? 'bg-white' : 'bg-gray-50 text-gray-400'}
                            ${isToday ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-200'}
                            ${hasOfficers ? 'hover:bg-green-50 hover:border-green-300' : 'hover:bg-blue-50 hover:border-blue-300'}
                          `}
                      >
                        <div className="flex flex-col items-center h-full">
                          <div className="text-sm font-medium">{format(day, 'd')}</div>
                          {hasOfficers && (
                            <>
                              <div className="mt-1">
                                <Badge className="bg-green-500 text-white text-xs px-1.5 py-0">
                                  {officersOnDuty.length}
                                </Badge>
                              </div>
                               <div className="mt-1 flex justify-center">
                                 <div className="w-4 h-4 bg-green-500 rounded-full border-2 border-white shadow-sm"></div>
                               </div>
                            </>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>

                <div className="mt-4 flex items-center gap-4 text-sm text-gray-600">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-green-500 rounded-full border-2 border-white shadow-sm"></div>
                    <span>Has officers on duty</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 border-2 border-blue-500 rounded-full"></div>
                    <span>Today</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Footer Info */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <div className="flex items-center justify-center gap-6 flex-wrap">
            <span className="flex items-center gap-1">
              <MapPin className="w-4 h-4" />
              BCPS-1
            </span>
            <span className="flex items-center gap-1">
              <Phone className="w-4 h-4" />
              Emergency: 911
            </span>
            <span className="flex items-center gap-1">
              <CalendarIcon className="w-4 h-4" />
              Duty Date: {format(new Date(), 'MMMM d, yyyy')}
            </span>
          </div>
        </div>
      </main>

      {/* Day Details Dialog */}
      <Dialog open={dayDetailsOpen} onOpenChange={setDayDetailsOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="w-5 h-5" />
              {selectedDate && format(selectedDate, 'MMMM d, yyyy')}
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-8"
                onClick={() => {
                  setDayDetailsOpen(false)
                  setAssignDialogOpen(true)
                }}
              >
                <UserPlus className="w-4 h-4 mr-1" />
                Add
              </Button>
            </DialogTitle>
            <DialogDescription>
              Officers on duty for this day. Click + on calendar to assign.
            </DialogDescription>
          </DialogHeader>

          {selectedDate && (
            <div className="py-4">
              {(() => {
                const officersOnDuty = getOfficersOnDutyForDate(selectedDate)
                if (officersOnDuty.length === 0) {
                  return (
                    <div className="text-center py-8 text-gray-500">
                      <UserX className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                      <p>No officers on duty this day</p>
                    </div>
                  )
                }
                return (
                  <div className="space-y-3">
                    {officersOnDuty.map((officer) => {
                      const dateStr = format(selectedDate, 'yyyy-MM-dd')

                      // Find duty record from Supabase or local history
                      let dutyRecord: { timeIn: string; timeOut: string | null } | undefined
                      let dutyRecordId: string | undefined
                      if (dutyRecords && dutyRecords.length > 0) {
                        const sbRecord = dutyRecords.find(
                          (r) => r.officer_id === officer.id && r.duty_date === dateStr,
                        )
                        if (sbRecord) {
                          dutyRecordId = sbRecord.id
                          // Format the time strings to match local format
                          dutyRecord = {
                            timeIn: formatTime(sbRecord.time_in) || sbRecord.time_in,
                            timeOut: formatTime(sbRecord.time_out) || sbRecord.time_out,
                          }
                        }
                      } else {
                        dutyRecord = officer.dutyHistory?.find((r) => r.date === dateStr)
                      }

                      return (
                        <div
                          key={officer.id}
                          className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-200"
                        >
                          <div>
                            <div className="font-medium flex items-center gap-2">
                              {officer.name}
                              <Badge
                                className={
                                  officer.currentStatus === 'on-duty'
                                    ? 'bg-green-500 text-white text-xs'
                                    : 'bg-gray-400 text-white text-xs'
                                }
                              >
                                {officer.currentStatus === 'on-duty' ? 'On Duty' : 'Off Duty'}
                              </Badge>
                            </div>
                            <div className="text-sm text-gray-600">
                              {officer.rank}{' '}
                              {officer.badgeNumber && `• Badge #${officer.badgeNumber}`}
                            </div>
                            <div className="text-xs text-gray-500">{officer.unit}</div>
                          </div>
                          <div className="text-right flex items-center gap-1">
                             {dutyRecord && (
                               <div className="text-green-700 flex items-center gap-1">
                                 <Clock className="w-3 h-3" />
                                 Checked In
                               </div>
                             )}
                             {dutyRecord && (
                               <>
                                 <Button
                                   size="sm"
                                   variant="ghost"
                                   onClick={(e) => {
                                     e.stopPropagation()
                                     if (dutyRecordId) {
                                       setEditDutyDialog({ open: true, dutyRecordId, currentOfficerId: officer.id })
                                     }
                                   }}
                                   className="h-8 w-8 p-0 text-blue-500 hover:text-blue-700 hover:bg-blue-50 flex-shrink-0"
                                   title="Edit assignment"
                                 >
                                   <Edit2 className="w-4 h-4" />
                                 </Button>
                                 <Button
                                   size="sm"
                                   variant="ghost"
                                   onClick={(e) => {
                                     e.stopPropagation()
                                     if (dutyRecordId) {
                                       setDeleteDutyDialog({ open: true, dutyRecordId })
                                     }
                                   }}
                                   className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 flex-shrink-0"
                                   title="Remove duty record"
                                 >
                                   <Trash2 className="w-4 h-4" />
                                 </Button>
                               </>
                             )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setDayDetailsOpen(false)} variant="outline">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Duty Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Officer to Duty</DialogTitle>
            <DialogDescription>
              Assign an officer to duty on {selectedDate && format(selectedDate!, 'MMMM d, yyyy')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Officer</label>
              <Select value={selectedOfficerId} onValueChange={setSelectedOfficerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select officer" />
                </SelectTrigger>
                <SelectContent>
                  {(() => {
                    const officersOnDutyIds = new Set(
                      getOfficersOnDutyForDate(selectedDate || new Date()).map((o) => o.id),
                    )
                    const availableOfficers = officers.filter((o) => !officersOnDutyIds.has(o.id))
                    return availableOfficers.map((officer) => (
                      <SelectItem key={officer.id} value={officer.id}>
                        {officer.name} ({officer.rank})
                      </SelectItem>
                    ))
                  })()}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!selectedDate || !selectedOfficerId) {
                  toast.error('Please select an officer')
                  return
                }
                try {
                  const dateStr = format(selectedDate, 'yyyy-MM-dd')
                  console.log('Assigning officer:', selectedOfficerId, 'for date:', dateStr)

                  // Set timeIn if assigning to today
                  const now = new Date()
                  const phTime = new Date(now.toLocaleString('en-PH', { timeZone: 'Asia/Manila' }))
                  const todayStr = format(phTime, 'yyyy-MM-dd')
                  const timeIn = dateStr === todayStr ? format(phTime, 'HH:mm:ss') : undefined

                   await addDutyRecord(selectedOfficerId, dateStr, timeIn, undefined, undefined)
                   toast.success('Officer assigned to duty')
                  setAssignDialogOpen(false)
                  // Reset form
                  setSelectedOfficerId('')
                } catch (error: unknown) {
                  console.error('Assign error:', error)
                  toast.error(error instanceof Error ? error.message : 'Failed to assign duty')
                }
              }}
              disabled={!selectedOfficerId || loading}
            >
              Assign Duty
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Duty Assignment Dialog */}
      <Dialog open={editDutyDialog.open} onOpenChange={() => setEditDutyDialog({ ...editDutyDialog, open: false })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Officer Assignment</DialogTitle>
            <DialogDescription>
              Change the officer assigned to {selectedDate && format(selectedDate!, 'MMMM d, yyyy')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select New Officer</label>
              <Select value={selectedOfficerId} onValueChange={setSelectedOfficerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select officer" />
                </SelectTrigger>
                <SelectContent>
                  {officers.map((officer) => (
                    <SelectItem key={officer.id} value={officer.id}>
                      {officer.name} ({officer.rank})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDutyDialog({ ...editDutyDialog, open: false })}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!selectedOfficerId) {
                  toast.error('Please select an officer')
                  return
                }
                try {
                   await updateDutyRecord(editDutyDialog.dutyRecordId, { officer_id: selectedOfficerId })
                   toast.success('Officer assignment updated')
                  setEditDutyDialog({ open: false, dutyRecordId: '', currentOfficerId: '' })
                  setSelectedOfficerId('')
                } catch (error: unknown) {
                  console.error('Edit error:', error)
                  toast.error(error instanceof Error ? error.message : 'Failed to update assignment')
                }
              }}
              disabled={!selectedOfficerId || loading}
            >
              Update Assignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editingOfficer} onOpenChange={() => setEditingOfficer(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Officer Information</DialogTitle>
            <DialogDescription>Update the officer's details below.</DialogDescription>
          </DialogHeader>
          {editingOfficer && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Full Name</label>
                <Input
                  value={editingOfficer.name}
                  onChange={(e) => setEditingOfficer({ ...editingOfficer, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Rank</label>
                <Input
                  value={editingOfficer.rank}
                  onChange={(e) => setEditingOfficer({ ...editingOfficer, rank: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Badge Number</label>
                <Input
                  value={editingOfficer.badgeNumber || ''}
                  onChange={(e) =>
                    setEditingOfficer({ ...editingOfficer, badgeNumber: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Unit/Station</label>
                <Input
                  value={editingOfficer.unit}
                  onChange={(e) => setEditingOfficer({ ...editingOfficer, unit: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingOfficer(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} className="bg-blue-700 hover:bg-blue-800" disabled={loading}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Duty Record Confirmation Dialog */}
      <Dialog
        open={deleteDutyDialog.open}
        onOpenChange={() => setDeleteDutyDialog({ ...deleteDutyDialog, open: false })}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Remove Duty Record</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove this duty record? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteDutyDialog({ ...deleteDutyDialog, open: false })}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                const success = await deleteDutyRecord(deleteDutyDialog.dutyRecordId)
                setDeleteDutyDialog({ open: false, dutyRecordId: '' })
                if (success) {
                  toast.success('Duty record removed')
                } else {
                  toast.error('Failed to remove duty record')
                }
              }}
              disabled={loading}
            >
              Remove Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Remove</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove this officer from the officer list?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={loading}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default App
