import { useState } from 'react';
import { appApi } from '@/lib/appApi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, CalendarDays, Star } from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const PH_HOLIDAYS_2026 = [
  { name: "New Year's Day", date: "2026-01-01", type: "regular_holiday" },
  { name: "People Power Revolution Anniversary", date: "2026-02-25", type: "special_holiday" },
  { name: "Araw ng Kagitingan (Bataan & Corregidor Day)", date: "2026-04-09", type: "regular_holiday" },
  { name: "Maundy Thursday", date: "2026-04-02", type: "regular_holiday" },
  { name: "Good Friday", date: "2026-04-03", type: "regular_holiday" },
  { name: "Black Saturday", date: "2026-04-04", type: "special_holiday" },
  { name: "Labor Day", date: "2026-05-01", type: "regular_holiday" },
  { name: "Independence Day", date: "2026-06-12", type: "regular_holiday" },
  { name: "Eid al-Fitr", date: "2026-04-21", type: "regular_holiday" },
  { name: "Eid al-Adha", date: "2026-06-27", type: "regular_holiday" },
  { name: "National Heroes Day", date: "2026-08-31", type: "regular_holiday" },
  { name: "Bonifacio Day", date: "2026-11-30", type: "regular_holiday" },
  { name: "Christmas Day", date: "2026-12-25", type: "regular_holiday" },
  { name: "Rizal Day", date: "2026-12-30", type: "regular_holiday" },
  { name: "Last Day of the Year", date: "2026-12-31", type: "special_holiday" },
  { name: "All Saints Day", date: "2026-11-01", type: "special_holiday" },
  { name: "Ninoy Aquino Day", date: "2026-08-21", type: "special_holiday" },
  { name: "Christmas Eve", date: "2026-12-24", type: "special_holiday" },
];

export default function Holidays() {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', date: '', type: 'regular_holiday', description: '', year: new Date().getFullYear() });
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();

  const { data: holidays = [], isLoading } = useQuery({
    queryKey: ['holidays', activeCompanyId],
    queryFn: () => appApi.entities.Holiday.filter({ company_profile_id: activeCompanyId }, 'date', 100),
    enabled: !!activeCompanyId,
  });

  const createMutation = useMutation({
    mutationFn: (data) => appApi.entities.Holiday.create({ ...data, company_profile_id: activeCompanyId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['holidays'] }); setShowForm(false); setForm({ name: '', date: '', type: 'regular_holiday', description: '', year: new Date().getFullYear() }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => appApi.entities.Holiday.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['holidays'] }),
  });

  const seedHolidays = async () => {
    for (const h of PH_HOLIDAYS_2026) {
      await appApi.entities.Holiday.create({ ...h, year: 2026, company_profile_id: activeCompanyId });
    }
    qc.invalidateQueries({ queryKey: ['holidays'] });
  };

  const regular = holidays.filter(h => h.type === 'regular_holiday');
  const special = holidays.filter(h => h.type === 'special_holiday');
  const specialWorking = holidays.filter(h => h.type === 'special_working_holiday');

  const HolidayList = ({ items, color }) => (
    <div className="space-y-2">
      {items.map(h => (
        <div key={h.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/40 hover:bg-muted/70 transition-colors">
          <div className="flex items-center gap-3">
            <CalendarDays className={`w-4 h-4 ${color}`} />
            <div>
              <p className="text-sm font-medium text-foreground">{h.name}</p>
              <p className="text-xs text-muted-foreground">{h.date}</p>
            </div>
          </div>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10"
            onClick={() => deleteMutation.mutate(h.id)}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}
      {items.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">None added yet.</p>}
    </div>
  );

  return (
    <div className="p-6 space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Philippine Holidays</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Regular (200%) · Special non-working (130%) · Special working (ordinary day)</p>
        </div>
        <div className="flex gap-2">
          {holidays.length === 0 && (
            <Button variant="outline" size="sm" onClick={seedHolidays} className="gap-2">
              <Star className="w-4 h-4" /> Seed 2026 Holidays
            </Button>
          )}
          <Button size="sm" onClick={() => setShowForm(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Add Holiday
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="border border-border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Badge className="bg-red-100 text-red-700 text-xs">Regular Holiday</Badge>
              <span className="text-muted-foreground font-normal">200% of daily rate</span>
            </CardTitle>
          </CardHeader>
          <CardContent><HolidayList items={regular} color="text-red-500" /></CardContent>
        </Card>

        <Card className="border border-border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Badge className="bg-orange-100 text-orange-700 text-xs">Special Holiday</Badge>
              <span className="text-muted-foreground font-normal">130% of daily rate</span>
            </CardTitle>
          </CardHeader>
          <CardContent><HolidayList items={special} color="text-orange-500" /></CardContent>
        </Card>

        <Card className="border border-border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Badge className="bg-blue-100 text-blue-700 text-xs">Special Working</Badge>
              <span className="text-muted-foreground font-normal">Ordinary day</span>
            </CardTitle>
          </CardHeader>
          <CardContent><HolidayList items={specialWorking} color="text-blue-500" /></CardContent>
        </Card>
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Holiday</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(form); }} className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Holiday Name *</Label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date *</Label>
              <Input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value, year: new Date(e.target.value).getFullYear() }))} required className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Type *</Label>
              <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="regular_holiday">Regular Holiday (200%)</SelectItem>
                  <SelectItem value="special_holiday">Special Non-Working Holiday (130%)</SelectItem>
                  <SelectItem value="special_working_holiday">Special Working Holiday (100%)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit" size="sm">Add Holiday</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
