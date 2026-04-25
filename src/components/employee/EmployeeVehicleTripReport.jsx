import { useState } from 'react';
import { appApi } from '@/lib/appApi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Plus, Trash2, Car, ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const EXPENSE_TYPES = [
  { value: 'rfid', label: 'RFID' },
  { value: 'fuel', label: 'Fuel' },
  { value: 'toll', label: 'Toll' },
  { value: 'traffic_violation', label: 'Traffic Violation' },
  { value: 'food', label: 'Food' },
];

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600',
  submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-600',
};

function emptyTrip() {
  return { origin: '', destination: '', departure_time: '', arrival_time: '', purpose: '' };
}

function emptyExpense() {
  return { expense_type: 'fuel', amount: '', notes: '' };
}

export default function EmployeeVehicleTripReport({ employee }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [form, setForm] = useState({
    report_date: format(new Date(), 'yyyy-MM-dd'),
    vehicle_plate: '',
    start_odometer: '',
    end_odometer: '',
    trip_budget: '',
    driver_name: '',
    crew_names: '',
    notes: '',
    trips: [emptyTrip()],
    expenses: [emptyExpense()],
  });

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['vehicleTripReports', employee?.employee_id],
    queryFn: () => appApi.entities.VehicleTripReport.filter({ employee_id: employee.employee_id }),
    enabled: !!employee?.employee_id,
  });

  const submitMutation = useMutation({
    mutationFn: (data) => appApi.entities.VehicleTripReport.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicleTripReports', employee?.employee_id] });
      setShowForm(false);
      resetForm();
    },
  });

  const resetForm = () => {
    setForm({
      report_date: format(new Date(), 'yyyy-MM-dd'),
      vehicle_plate: '',
      start_odometer: '',
      end_odometer: '',
      trip_budget: '',
      notes: '',
      trips: [emptyTrip()],
      expenses: [emptyExpense()],
    });
  };

  const handleSubmit = () => {
    const expenses = form.expenses.filter(e => e.amount !== '' && parseFloat(e.amount) > 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
    submitMutation.mutate({
      employee_id: employee.employee_id,
      employee_name: `${employee.first_name} ${employee.last_name}`,
      department: employee.department,
      report_date: form.report_date,
      vehicle_plate: form.vehicle_plate,
      start_odometer: parseFloat(form.start_odometer) || 0,
      end_odometer: parseFloat(form.end_odometer) || 0,
      trip_budget: parseFloat(form.trip_budget) || 0,
      driver_name: form.driver_name,
      crew_names: form.crew_names,
      trips: form.trips.filter(t => t.origin || t.destination),
      expenses,
      total_expenses: parseFloat(totalExpenses.toFixed(2)),
      notes: form.notes,
      status: 'submitted',
    });
  };

  const updateTrip = (idx, field, value) => {
    const trips = [...form.trips];
    trips[idx] = { ...trips[idx], [field]: value };
    setForm(f => ({ ...f, trips }));
  };

  const updateExpense = (idx, field, value) => {
    const expenses = [...form.expenses];
    expenses[idx] = { ...expenses[idx], [field]: value };
    setForm(f => ({ ...f, expenses }));
  };

  const sortedReports = [...reports].sort((a, b) => b.report_date.localeCompare(a.report_date));

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Vehicle Trip Reports</h2>
          <p className="text-xs text-muted-foreground">{employee?.first_name} {employee?.last_name}</p>
        </div>
        {!showForm && (
          <Button size="sm" className="gap-1.5" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4" /> New Report
          </Button>
        )}
      </div>

      {/* New Report Form */}
      {showForm && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-5">
          <p className="font-semibold text-foreground">New Trip Report</p>

          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="text-xs font-medium text-muted-foreground">Date</label>
              <Input type="date" value={form.report_date} onChange={e => setForm(f => ({ ...f, report_date: e.target.value }))} className="mt-1 text-sm" />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="text-xs font-medium text-muted-foreground">Vehicle Plate No.</label>
              <Input placeholder="e.g. ABC 1234" value={form.vehicle_plate} onChange={e => setForm(f => ({ ...f, vehicle_plate: e.target.value }))} className="mt-1 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Start Odometer (km)</label>
              <Input type="number" placeholder="0" value={form.start_odometer} onChange={e => setForm(f => ({ ...f, start_odometer: e.target.value }))} className="mt-1 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">End Odometer (km)</label>
              <Input type="number" placeholder="0" value={form.end_odometer} onChange={e => setForm(f => ({ ...f, end_odometer: e.target.value }))} className="mt-1 text-sm" />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="text-xs font-medium text-muted-foreground">Trip Budget (₱)</label>
              <Input type="number" placeholder="0.00" value={form.trip_budget} onChange={e => setForm(f => ({ ...f, trip_budget: e.target.value }))} className="mt-1 text-sm" />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="text-xs font-medium text-muted-foreground">Driver Name</label>
              <Input placeholder="Full name of driver" value={form.driver_name} onChange={e => setForm(f => ({ ...f, driver_name: e.target.value }))} className="mt-1 text-sm" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Crew / Passengers</label>
              <Input placeholder="e.g. Juan dela Cruz, Maria Santos" value={form.crew_names} onChange={e => setForm(f => ({ ...f, crew_names: e.target.value }))} className="mt-1 text-sm" />
            </div>
          </div>

          {/* Trips */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">Trips</p>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setForm(f => ({ ...f, trips: [...f.trips, emptyTrip()] }))}>
                <Plus className="w-3 h-3" /> Add Trip
              </Button>
            </div>
            {form.trips.map((trip, idx) => (
              <div key={idx} className="bg-muted/40 rounded-lg p-3 space-y-2 relative">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">Trip {idx + 1}</p>
                  {form.trips.length > 1 && (
                    <button onClick={() => setForm(f => ({ ...f, trips: f.trips.filter((_, i) => i !== idx) }))} className="text-destructive hover:text-destructive/80">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground">Origin</label>
                    <Input placeholder="From" value={trip.origin} onChange={e => updateTrip(idx, 'origin', e.target.value)} className="mt-0.5 text-xs h-8" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Destination</label>
                    <Input placeholder="To" value={trip.destination} onChange={e => updateTrip(idx, 'destination', e.target.value)} className="mt-0.5 text-xs h-8" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Departure Time</label>
                    <Input type="time" value={trip.departure_time} onChange={e => updateTrip(idx, 'departure_time', e.target.value)} className="mt-0.5 text-xs h-8" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Arrival Time</label>
                    <Input type="time" value={trip.arrival_time} onChange={e => updateTrip(idx, 'arrival_time', e.target.value)} className="mt-0.5 text-xs h-8" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-muted-foreground">Purpose</label>
                    <Input placeholder="Purpose of trip" value={trip.purpose} onChange={e => updateTrip(idx, 'purpose', e.target.value)} className="mt-0.5 text-xs h-8" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Expenses / Liquidation */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">Trip Liquidation</p>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setForm(f => ({ ...f, expenses: [...f.expenses, emptyExpense()] }))}>
                <Plus className="w-3 h-3" /> Add Expense
              </Button>
            </div>
            {form.expenses.map((exp, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Select value={exp.expense_type} onValueChange={v => updateExpense(idx, 'expense_type', v)}>
                  <SelectTrigger className="h-8 text-xs w-40 flex-shrink-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EXPENSE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input type="number" placeholder="Amount" value={exp.amount} onChange={e => updateExpense(idx, 'amount', e.target.value)} className="h-8 text-xs w-24 flex-shrink-0" />
                <Input placeholder="Notes (optional)" value={exp.notes} onChange={e => updateExpense(idx, 'notes', e.target.value)} className="h-8 text-xs flex-1 min-w-0" />
                {form.expenses.length > 1 && (
                  <button onClick={() => setForm(f => ({ ...f, expenses: f.expenses.filter((_, i) => i !== idx) }))} className="text-destructive flex-shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
            {(() => {
              const total = form.expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
              const budget = parseFloat(form.trip_budget) || 0;
              const diff = budget - total;
              return (
                <div className="bg-muted/40 rounded-lg p-3 space-y-1 text-sm mt-2">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Total Expenses</span>
                    <span className="font-semibold text-foreground">₱{total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                  </div>
                  {budget > 0 && (
                    <>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Trip Budget</span>
                        <span className="font-semibold text-foreground">₱{budget.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex justify-between border-t border-border pt-1 font-semibold">
                        <span>{diff >= 0 ? 'Remaining Budget' : 'Over Budget'}</span>
                        <span className={diff >= 0 ? 'text-green-600' : 'text-destructive'}>
                          {diff >= 0 ? '' : '-'}₱{Math.abs(diff).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Remarks / Notes</label>
            <Input placeholder="Optional remarks" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="mt-1 text-sm" />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={submitMutation.isPending}>
              {submitMutation.isPending ? 'Submitting...' : 'Submit Report'}
            </Button>
          </div>
        </div>
      )}

      {/* Reports List */}
      {isLoading ? (
        <div className="flex justify-center py-10"><div className="w-7 h-7 border-4 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
      ) : sortedReports.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-muted-foreground">
          <Car className="w-10 h-10 mb-3 opacity-20" />
          <p className="text-sm">No trip reports yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedReports.map(report => (
            <div key={report.id} className="bg-card border border-border rounded-xl overflow-hidden">
              <button
                className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedId(expandedId === report.id ? null : report.id)}
              >
                <div className="flex items-center gap-3 text-left">
                  <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">{report.report_date}</p>
                    <p className="text-xs text-muted-foreground">{report.vehicle_plate || 'No plate'} · {report.trips?.length || 0} trip(s) · ₱{(report.total_expenses || 0).toLocaleString()}{report.trip_budget > 0 ? ` / ₱${report.trip_budget.toLocaleString()} budget` : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={`text-xs capitalize ${STATUS_COLORS[report.status]}`}>{report.status}</Badge>
                  {expandedId === report.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </div>
              </button>

              {expandedId === report.id && (
                <div className="border-t border-border p-4 space-y-4 text-sm">
                  {/* Driver / Crew */}
                  {(report.driver_name || report.crew_names) && (
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      {report.driver_name && (
                        <div className="bg-muted/30 rounded-lg p-2.5">
                          <p className="text-muted-foreground mb-0.5">Driver</p>
                          <p className="font-semibold text-foreground">{report.driver_name}</p>
                        </div>
                      )}
                      {report.crew_names && (
                        <div className="bg-muted/30 rounded-lg p-2.5">
                          <p className="text-muted-foreground mb-0.5">Crew / Passengers</p>
                          <p className="font-semibold text-foreground">{report.crew_names}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Odometer */}
                  <div className="grid grid-cols-3 gap-3 bg-muted/30 rounded-lg p-3 text-xs text-center">
                    <div><p className="text-muted-foreground">Start Odometer</p><p className="font-semibold">{report.start_odometer?.toLocaleString()} km</p></div>
                    <div><p className="text-muted-foreground">End Odometer</p><p className="font-semibold">{report.end_odometer?.toLocaleString()} km</p></div>
                    <div><p className="text-muted-foreground">Total KM</p><p className="font-semibold text-primary">{((report.end_odometer || 0) - (report.start_odometer || 0)).toLocaleString()} km</p></div>
                  </div>

                  {/* Trips */}
                  {report.trips?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Trips</p>
                      <div className="space-y-2">
                        {report.trips.map((trip, i) => (
                          <div key={i} className="bg-muted/20 rounded-lg p-2.5 text-xs space-y-1">
                            <div className="flex items-center gap-1.5 font-medium text-foreground">
                              <span>{trip.origin}</span><span className="text-muted-foreground">→</span><span>{trip.destination}</span>
                            </div>
                            <div className="flex gap-4 text-muted-foreground">
                              {trip.departure_time && <span>Depart: {trip.departure_time}</span>}
                              {trip.arrival_time && <span>Arrive: {trip.arrival_time}</span>}
                            </div>
                            {trip.purpose && <p className="text-muted-foreground italic">{trip.purpose}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Expenses */}
                  {report.expenses?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Liquidation</p>
                      <div className="space-y-1">
                        {report.expenses.map((exp, i) => (
                          <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-border last:border-0">
                            <div>
                              <span className="font-medium capitalize">{EXPENSE_TYPES.find(t => t.value === exp.expense_type)?.label || exp.expense_type}</span>
                              {exp.notes && <span className="text-muted-foreground ml-2">— {exp.notes}</span>}
                            </div>
                            <span className="font-semibold">₱{parseFloat(exp.amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                          </div>
                        ))}
                        <div className="flex justify-between font-bold text-sm pt-1">
                          <span>Total Expenses</span>
                          <span className="text-primary">₱{(report.total_expenses || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                        </div>
                        {report.trip_budget > 0 && (() => {
                          const diff = (report.trip_budget || 0) - (report.total_expenses || 0);
                          return (
                            <>
                              <div className="flex justify-between text-xs text-muted-foreground">
                                <span>Trip Budget</span>
                                <span>₱{(report.trip_budget || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                              </div>
                              <div className={`flex justify-between text-xs font-semibold pt-1 border-t border-border ${diff >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                                <span>{diff >= 0 ? 'Remaining Budget' : 'Over Budget'}</span>
                                <span>{diff >= 0 ? '' : '-'}₱{Math.abs(diff).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {report.notes && <p className="text-xs text-muted-foreground italic">Remarks: {report.notes}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}