import { useState } from 'react';
import { appApi } from '@/lib/appApi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, BanIcon, CalendarOff, Info } from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';

export default function NoWorkDays() {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ date: '', reason: '', notes: '' });
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();

  const { data: noWorkDays = [], isLoading } = useQuery({
    queryKey: ['noWorkDays', activeCompanyId],
    queryFn: () => appApi.entities.NoWorkDay.filter({ company_profile_id: activeCompanyId }, '-date', 200),
    enabled: !!activeCompanyId,
  });

  const { data: user } = useQuery({
    queryKey: ['me'],
    queryFn: () => appApi.auth.me(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => appApi.entities.NoWorkDay.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['noWorkDays'] });
      setShowForm(false);
      setForm({ date: '', reason: '', notes: '' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => appApi.entities.NoWorkDay.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['noWorkDays'] }),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    // Check for duplicate
    if (noWorkDays.some(d => d.date === form.date)) {
      alert('A no-work day has already been declared for this date.');
      return;
    }
    createMutation.mutate({
      ...form,
      declared_by: user?.full_name || user?.email || 'HR',
      company_profile_id: activeCompanyId,
    });
  };

  const upcoming = noWorkDays.filter(d => d.date >= format(new Date(), 'yyyy-MM-dd'));
  const past = noWorkDays.filter(d => d.date < format(new Date(), 'yyyy-MM-dd'));

  return (
    <div className="p-6 space-y-5 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CalendarOff className="w-6 h-6 text-primary" />
            No-Work Days
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Declare company-wide no-work days. Policy: No Work = No Pay (except Regular Holidays).
          </p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)} className="gap-2">
          <Plus className="w-4 h-4" /> Declare No-Work Day
        </Button>
      </div>

      {/* Policy Note */}
      <div className="flex items-start gap-2 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm">
        <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-amber-800">
          <p className="font-medium">No Work, No Pay Policy</p>
          <p className="text-xs mt-0.5">Employees who do not work on declared no-work days will receive no pay for that day. <strong>Exception:</strong> If the day falls on a Regular Holiday, employees still receive 100% of their daily rate.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Upcoming */}
          <Card className="border border-border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Badge className="bg-red-100 text-red-700 text-xs border-0">Upcoming / Current</Badge>
                <span className="text-muted-foreground font-normal">{upcoming.length} day(s)</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No upcoming no-work days declared.</p>
              ) : (
                <div className="space-y-2">
                  {upcoming.map(d => (
                    <NoWorkDayRow key={d.id} day={d} onDelete={() => deleteMutation.mutate(d.id)} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Past */}
          {past.length > 0 && (
            <Card className="border border-border shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Badge className="bg-gray-100 text-gray-600 text-xs border-0">Past</Badge>
                  <span className="text-muted-foreground font-normal">{past.length} day(s)</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {past.map(d => (
                    <NoWorkDayRow key={d.id} day={d} onDelete={() => deleteMutation.mutate(d.id)} isPast />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Declare Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); setForm({ date: '', reason: '', notes: '' }); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Declare No-Work Day</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Date *</Label>
              <Input
                type="date"
                value={form.date}
                onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                required
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Reason *</Label>
              <Input
                value={form.reason}
                onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}
                placeholder="e.g. Typhoon signal, Company event..."
                required
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes (optional)</Label>
              <Input
                value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                placeholder="Additional details..."
                className="h-8 text-sm"
              />
            </div>
            <div className="flex items-start gap-2 p-2.5 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-700">
              <BanIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              Employees will not be paid for this day unless it falls on a Regular Holiday.
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Saving...' : 'Declare'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NoWorkDayRow({ day, onDelete, isPast }) {
  return (
    <div className={`flex items-center justify-between py-2 px-3 rounded-lg transition-colors ${isPast ? 'bg-muted/30' : 'bg-red-50 hover:bg-red-100/60'}`}>
      <div className="flex items-center gap-3">
        <CalendarOff className={`w-4 h-4 flex-shrink-0 ${isPast ? 'text-muted-foreground' : 'text-red-500'}`} />
        <div>
          <p className={`text-sm font-medium ${isPast ? 'text-muted-foreground' : 'text-foreground'}`}>
            {day.date} &mdash; {day.reason}
          </p>
          <p className="text-xs text-muted-foreground">
            Declared by {day.declared_by || 'HR'}
            {day.notes && ` · ${day.notes}`}
          </p>
        </div>
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-destructive hover:bg-destructive/10 flex-shrink-0"
        onClick={onDelete}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}