import { useState } from 'react';
import { appApi } from '@/lib/appApi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Sun, Moon, UserCircle, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';

const shiftConfig = {
  day_shift:   { label: 'Day Shift',   icon: Sun,  className: 'bg-amber-100 text-amber-700 border-amber-200' },
  night_shift: { label: 'Night Shift', icon: Moon, className: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
};

function ShiftBadge({ shift }) {
  const resolved = shift || 'day_shift';
  const cfg = shiftConfig[resolved];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`gap-1 text-xs ${cfg.className}`}>
      <Icon className="w-3 h-3" /> {cfg.label}
    </Badge>
  );
}

export default function WorkSchedule() {
  const [search, setSearch] = useState('');
  const [filterShift, setFilterShift] = useState('all');
  const [savingId, setSavingId] = useState(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: () => appApi.entities.Employee.filter({ status: 'active' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, work_schedule }) => appApi.entities.Employee.update(id, { work_schedule }),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      setSavingId(null);
      toast({ title: 'Shift updated', description: 'Work schedule saved successfully.' });
    },
  });

  const handleShiftChange = (emp, value) => {
    setSavingId(emp.id);
    updateMutation.mutate({ id: emp.id, work_schedule: value });
  };

  const filtered = employees
    .filter(e => `${e.first_name} ${e.last_name} ${e.employee_id} ${e.department}`.toLowerCase().includes(search.toLowerCase()))
    .filter(e => filterShift === 'all' || (filterShift === 'day_shift' ? (!e.work_schedule || e.work_schedule === 'day_shift') : e.work_schedule === filterShift));

  const counts = {
    day_shift: employees.filter(e => !e.work_schedule || e.work_schedule === 'day_shift').length,
    night_shift: employees.filter(e => e.work_schedule === 'night_shift').length,
    unassigned: 0,
  };

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Work Schedule</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Assign day or night shift to each employee</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
          <Sun className="w-5 h-5 text-amber-600" />
          <div>
            <p className="text-xl font-bold text-amber-700">{counts.day_shift}</p>
            <p className="text-xs text-amber-600">Day Shift</p>
          </div>
        </div>
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-center gap-3">
          <Moon className="w-5 h-5 text-indigo-600" />
          <div>
            <p className="text-xl font-bold text-indigo-700">{counts.night_shift}</p>
            <p className="text-xs text-indigo-600">Night Shift</p>
          </div>
        </div>
        <div className="bg-muted border border-border rounded-xl p-4 flex items-center gap-3">
          <UserCircle className="w-5 h-5 text-muted-foreground" />
          <div>
            <p className="text-xl font-bold text-foreground">{counts.unassigned}</p>
            <p className="text-xs text-muted-foreground">Unassigned</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search employees..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterShift} onValueChange={setFilterShift}>
          <SelectTrigger className="w-44 h-9 text-sm"><SelectValue placeholder="All Shifts" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Shifts</SelectItem>
            <SelectItem value="day_shift">Day Shift</SelectItem>
            <SelectItem value="night_shift">Night Shift</SelectItem>
  
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <Card className="border border-border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Employee</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs hidden sm:table-cell">Department</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Current Shift</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Assign Shift</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-12 text-muted-foreground text-sm">No employees found.</td></tr>
              ) : (
                filtered.map(emp => (
                  <tr key={emp.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                          {emp.photo_url
                            ? <img src={emp.photo_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                            : <UserCircle className="w-4 h-4 text-primary" />}
                        </div>
                        <div>
                          <p className="font-medium text-foreground text-sm">{emp.first_name} {emp.last_name}</p>
                          <p className="text-xs text-muted-foreground">{emp.employee_id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden sm:table-cell">{emp.department || '—'}</td>
                    <td className="px-4 py-3">
                      <ShiftBadge shift={emp.work_schedule || 'day_shift'} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Select
                          value={emp.work_schedule || 'day_shift'}
                          onValueChange={v => handleShiftChange(emp, v)}
                        >
                          <SelectTrigger className="h-8 text-xs w-36">
                            <SelectValue placeholder="Select shift..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="day_shift">
                              <span className="flex items-center gap-1.5"><Sun className="w-3.5 h-3.5 text-amber-500" /> Day Shift</span>
                            </SelectItem>
                            <SelectItem value="night_shift">
                              <span className="flex items-center gap-1.5"><Moon className="w-3.5 h-3.5 text-indigo-500" /> Night Shift</span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        {savingId === emp.id && (
                          <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                        )}
                        {savingId !== emp.id && emp.work_schedule && (
                          <CheckCircle2 className="w-4 h-4 text-green-500 opacity-60" />
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}