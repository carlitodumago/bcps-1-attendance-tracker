import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
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
  Clock
} from 'lucide-react'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
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
  subMonths
} from 'date-fns'

interface DutyRecord {
  timeIn: string
  timeOut: string | null
  date: string
}

interface Officer {
  id: string
  name: string
  rank: string
  badgeNumber?: string
  unit: string
  dutyHistory: DutyRecord[]
  currentStatus: 'on-duty' | 'off-duty'
}

function App() {
  // Load officers from localStorage on initial state setup
  const [officers, setOfficers] = useState<Officer[]>(() => {
    const savedOfficers = localStorage.getItem('bcsp-1-attendance-tracker')
    if (savedOfficers) {
      try {
        return JSON.parse(savedOfficers)
      } catch {
        console.error('Failed to parse saved officers')
        return []
      }
    }
    return []
  })
  const [name, setName] = useState('')
  const [rank, setRank] = useState('')
  const [badgeNumber, setBadgeNumber] = useState('')
  const [unit, setUnit] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [editingOfficer, setEditingOfficer] = useState<Officer | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [officerToDelete, setOfficerToDelete] = useState<string | null>(null)
  
  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [dayDetailsOpen, setDayDetailsOpen] = useState(false)

  // Save officers to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('bcsp-1-attendance-tracker', JSON.stringify(officers))
  }, [officers])

  const generateId = () => {
    return Date.now().toString(36) + Math.random().toString(36).substr(2)
  }

  const getCurrentTime = () => {
    return new Date().toLocaleTimeString('en-PH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    })
  }

  const getCurrentDate = () => {
    return new Date().toISOString().split('T')[0]
  }

  const handleAddOfficer = () => {
    if (!name.trim()) {
      toast.error('Please enter officer name')
      return
    }
    if (!rank.trim()) {
      toast.error('Please enter rank')
      return
    }

    const newOfficer: Officer = {
      id: generateId(),
      name: name.trim(),
      rank: rank.trim(),
      badgeNumber: badgeNumber.trim() || undefined,
      unit: unit.trim() || 'Unassigned',
      dutyHistory: [],
      currentStatus: 'off-duty'
    }

    setOfficers([newOfficer, ...officers])
    setName('')
    setRank('')
    setBadgeNumber('')
    setUnit('')
    toast.success('Officer registered successfully')
  }

  const handleOnDuty = (id: string) => {
    const today = getCurrentDate()
    const now = getCurrentTime()
    
    setOfficers(officers.map(officer => {
      if (officer.id === id) {
        const newRecord: DutyRecord = {
          timeIn: now,
          timeOut: null,
          date: today
        }
        return {
          ...officer,
          dutyHistory: [...officer.dutyHistory, newRecord],
          currentStatus: 'on-duty'
        }
      }
      return officer
    }))
    toast.success('Officer is now ON DUTY')
  }

  const handleOffDuty = (id: string) => {
    const now = getCurrentTime()
    
    setOfficers(officers.map(officer => {
      if (officer.id === id) {
        const updatedHistory = [...officer.dutyHistory]
        const lastRecord = updatedHistory[updatedHistory.length - 1]
        if (lastRecord && !lastRecord.timeOut) {
          lastRecord.timeOut = now
        }
        return {
          ...officer,
          dutyHistory: updatedHistory,
          currentStatus: 'off-duty'
        }
      }
      return officer
    }))
    toast.success('Officer is now OFF DUTY')
  }

  const handleDelete = (id: string) => {
    setOfficerToDelete(id)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = () => {
    if (officerToDelete) {
      setOfficers(officers.filter(officer => officer.id !== officerToDelete))
      toast.success('Officer removed from logbook')
      setDeleteDialogOpen(false)
      setOfficerToDelete(null)
    }
  }

  const handleEdit = (officer: Officer) => {
    setEditingOfficer(officer)
  }

  const saveEdit = () => {
    if (editingOfficer) {
      if (!editingOfficer.name.trim()) {
        toast.error('Name cannot be empty')
        return
      }
      if (!editingOfficer.rank.trim()) {
        toast.error('Rank cannot be empty')
        return
      }
      setOfficers(officers.map(officer => 
        officer.id === editingOfficer.id ? editingOfficer : officer
      ))
      setEditingOfficer(null)
      toast.success('Officer information updated')
    }
  }

  // Get officers on duty for a specific date
  const getOfficersOnDutyForDate = (date: Date): Officer[] => {
    const dateStr = format(date, 'yyyy-MM-dd')
    return officers.filter(officer => 
      officer.dutyHistory.some(record => record.date === dateStr)
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
    setDayDetailsOpen(true)
  }

  const onDutyOfficers = officers.filter(o => o.currentStatus === 'on-duty')
  const offDutyOfficers = officers.filter(o => o.currentStatus === 'off-duty')

  const filteredOfficers = officers.filter(officer => 
    officer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    officer.rank.toLowerCase().includes(searchTerm.toLowerCase()) ||
    officer.unit.toLowerCase().includes(searchTerm.toLowerCase()) ||
    officer.badgeNumber?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50">
      <Toaster position="top-right" richColors />
      
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 text-white shadow-lg">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-center gap-4">
            <div className="bg-white/10 p-3 rounded-full backdrop-blur-sm">
              <Shield className="w-10 h-10 text-yellow-400" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl md:text-3xl font-bold tracking-wide">
                BCSP-1
              </h1>
              <p className="text-blue-200 text-sm md:text-base">Attendance Tracker</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
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
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column - Calendar */}
          <div>
            <Card className="border-2 border-blue-100 shadow-xl bg-white/80 backdrop-blur">
              <CardHeader className="bg-gradient-to-r from-blue-50 to-white border-b border-blue-100">
                <CardTitle className="flex items-center gap-2 text-blue-900">
                  <CalendarDays className="w-5 h-5" />
                  Duty Calendar
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
                  {weekDays.map(day => (
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
                          aspect-square p-2 rounded-lg border transition-all hover:scale-105
                          ${isCurrentMonth ? 'bg-white' : 'bg-gray-50 text-gray-400'}
                          ${isToday ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-200'}
                          ${hasOfficers ? 'hover:bg-green-50 hover:border-green-300' : 'hover:bg-blue-50 hover:border-blue-300'}
                        `}
                      >
                        <div className="text-sm font-medium">{format(day, 'd')}</div>
                        {hasOfficers && (
                          <div className="mt-1">
                            <Badge className="bg-green-500 text-white text-xs px-1.5 py-0">
                              {officersOnDuty.length}
                            </Badge>
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>

                <div className="mt-4 flex items-center gap-4 text-sm text-gray-600">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
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

          {/* Right Column - Officer Management */}
          <div className="space-y-6">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search officers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 border-gray-200 h-9 text-sm"
              />
            </div>

            {/* Officer List */}
            <Card className="border-2 border-gray-100 shadow-xl bg-white/80 backdrop-blur">
              <CardHeader className="bg-gradient-to-r from-gray-50 to-white border-b border-gray-100 py-3">
                <CardTitle className="flex items-center gap-2 text-gray-700 text-base">
                  <Users className="w-4 h-4" />
                  Officers List
                  <Badge variant="secondary" className="ml-2 text-xs">
                    {filteredOfficers.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 max-h-80 overflow-y-auto">
                {filteredOfficers.length === 0 ? (
                  <div className="p-6 text-center text-gray-500">
                    <Users className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                    <p className="text-sm">No officers registered</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {filteredOfficers.map((officer) => (
                      <div key={officer.id} className="p-3 hover:bg-gray-50">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm truncate">{officer.name}</span>
                              {officer.currentStatus === 'on-duty' ? (
                                <Badge className="bg-green-500 text-white text-xs">On Duty</Badge>
                              ) : (
                                <Badge variant="outline" className="text-gray-500 text-xs">Off Duty</Badge>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              {officer.rank} {officer.badgeNumber && `• #${officer.badgeNumber}`} {officer.unit && `• ${officer.unit}`}
                            </div>
                          </div>
                          <div className="flex gap-1 ml-2">
                            {officer.currentStatus === 'off-duty' ? (
                              <Button
                                size="sm"
                                onClick={() => handleOnDuty(officer.id)}
                                className="bg-green-600 hover:bg-green-700 text-white h-7 px-2 text-xs"
                              >
                                <UserCheck className="w-3 h-3 mr-1" />
                                On
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => handleOffDuty(officer.id)}
                                variant="outline"
                                className="border-orange-400 text-orange-600 hover:bg-orange-50 h-7 px-2 text-xs"
                              >
                                <UserX className="w-3 h-3 mr-1" />
                                Off
                              </Button>
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
                )}
              </CardContent>
            </Card>

            {/* Add Officer Card */}
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
                    <label className="text-xs font-medium text-gray-700">Badge #</label>
                    <Input
                      placeholder="e.g., 12345"
                      value={badgeNumber}
                      onChange={(e) => setBadgeNumber(e.target.value)}
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
                <div className="mt-3 flex justify-end">
                  <Button 
                    onClick={handleAddOfficer}
                    size="sm"
                    className="bg-blue-700 hover:bg-blue-800 text-white"
                  >
                    <UserPlus className="w-4 h-4 mr-1" />
                    Register
                  </Button>
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
              BCSP-1
            </span>
            <span className="flex items-center gap-1">
              <Phone className="w-4 h-4" />
              Emergency: 911
            </span>
            <span className="flex items-center gap-1">
              <CalendarIcon className="w-4 h-4" />
              {format(new Date(), 'MMMM d, yyyy')}
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
            </DialogTitle>
            <DialogDescription>
              Officers on duty for this day
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
                    {officersOnDuty.map(officer => {
                      const dateStr = format(selectedDate, 'yyyy-MM-dd')
                      const dutyRecord = officer.dutyHistory.find(r => r.date === dateStr)
                      return (
                        <div key={officer.id} className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-200">
                          <div>
                            <div className="font-medium flex items-center gap-2">
                              {officer.name}
                              <Badge className="bg-green-500 text-white text-xs">On Duty</Badge>
                            </div>
                            <div className="text-sm text-gray-600">
                              {officer.rank} {officer.badgeNumber && `• Badge #${officer.badgeNumber}`}
                            </div>
                            <div className="text-xs text-gray-500">{officer.unit}</div>
                          </div>
                          <div className="text-right">
                            {dutyRecord && (
                              <div className="text-sm">
                                <div className="text-green-700 flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  <span className="text-xs text-gray-500">In:</span> {dutyRecord.timeIn}
                                </div>
                                {dutyRecord.timeOut && (
                                  <div className="text-orange-700 flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    <span className="text-xs text-gray-500">Out:</span> {dutyRecord.timeOut}
                                  </div>
                                )}
                              </div>
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

      {/* Edit Dialog */}
      <Dialog open={!!editingOfficer} onOpenChange={() => setEditingOfficer(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Officer Information</DialogTitle>
            <DialogDescription>
              Update the officer's details below.
            </DialogDescription>
          </DialogHeader>
          {editingOfficer && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Full Name</label>
                <Input
                  value={editingOfficer.name}
                  onChange={(e) => setEditingOfficer({...editingOfficer, name: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Rank</label>
                <Input
                  value={editingOfficer.rank}
                  onChange={(e) => setEditingOfficer({...editingOfficer, rank: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Badge Number</label>
                <Input
                  value={editingOfficer.badgeNumber || ''}
                  onChange={(e) => setEditingOfficer({...editingOfficer, badgeNumber: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Unit/Station</label>
                <Input
                  value={editingOfficer.unit}
                  onChange={(e) => setEditingOfficer({...editingOfficer, unit: e.target.value})}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingOfficer(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} className="bg-blue-700 hover:bg-blue-800">
              Save Changes
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
              Are you sure you want to remove this officer from the logbook?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default App
