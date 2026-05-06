import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appApi } from '@/lib/appApi';
import { Palmtree, Loader2, CalendarDays, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { format, parseISO } from 'date-fns';

const LEAVE_TYPES = [
  { value: 'personal', label: 'Personal' },
  { value: 'sick', label: 'Sick' },
  { value: 'vacation', label: 'Vacation' },
];

const statusStyles = {
  submitted: 'bg-amber-100 text-amber-800 border-amber-200',
  approved: 'bg-green-100 text-green-800 border-green-200',
  declined: 'bg-red-100 text-red-700 border-red-200',
};

const statusLabels = {
  submitted: 'Submitted',
  approved: 'Approved',
  declined: 'Declined',
};

export default function EmployeePersonalLeave({ employee }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [mainTab, setMainTab] = useState('create');
  const [leaveType, setLeaveType] = useState('personal');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

  const { data: leaves = [], isLoading } = useQuery({
    queryKey: ['personalLeaves', employee?.employee_id],
    queryFn: () =>
      appApi.entities.PersonalLeave.filter(
        { employee_id: employee.employee_id },
        '-created_date',
        200
      ),
    enabled: !!employee?.employee_id,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });

  const createMutation = useMutation({
    mutationFn: (payload) => appApi.entities.PersonalLeave.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['personalLeaves', employee?.employee_id] });
      setReason('');
      setStartDate('');
      setEndDate('');
      setLeaveType('personal');
      setMainTab('summary');
      toast({ title: 'Leave request submitted', description: 'HR will review your request.' });
    },
    onError: (err) => {
      toast({
        title: 'Could not submit',
        description: err?.message || 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!employee?.company_profile_id) {
      toast({
        title: 'Missing company',
        description: 'Your employee record has no company. Contact HR.',
        variant: 'destructive',
      });
      return;
    }
    if (!startDate || !endDate) {
      toast({ title: 'Dates required', description: 'Choose start and end dates.', variant: 'destructive' });
      return;
    }
    if (endDate < startDate) {
      toast({
        title: 'Invalid range',
        description: 'End date must be on or after start date.',
        variant: 'destructive',
      });
      return;
    }
    const trimmed = String(reason || '').trim();
    if (trimmed.length < 4) {
      toast({
        title: 'Reason too short',
        description: 'Please describe the reason for your leave.',
        variant: 'destructive',
      });
      return;
    }

    const name = [employee.first_name, employee.last_name].filter(Boolean).join(' ').trim();
    createMutation.mutate({
      employee_id: employee.employee_id,
      company_profile_id: employee.company_profile_id,
      employee_name: name || employee.employee_id,
      leave_type: leaveType,
      start_date: startDate,
      end_date: endDate,
      reason: trimmed,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    });
  };

  if (!employee) return null;

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Palmtree className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Personal leave</h1>
          <p className="text-sm text-muted-foreground">
            Request time off and track approvals from HR.
          </p>
        </div>
      </div>

      <Tabs value={mainTab} onValueChange={setMainTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="create" className="gap-2">
            <FileText className="w-4 h-4" />
            Create personal leave
          </TabsTrigger>
          <TabsTrigger value="summary" className="gap-2">
            <CalendarDays className="w-4 h-4" />
            Transactions summary
          </TabsTrigger>
        </TabsList>

        <TabsContent value="create" className="mt-4">
          <Card className="border-primary/20 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">New leave request</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
                <div className="space-y-2">
                  <Label>Leave type</Label>
                  <Select value={leaveType} onValueChange={setLeaveType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LEAVE_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="pl-start">Start date</Label>
                    <Input
                      id="pl-start"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pl-end">End date</Label>
                    <Input
                      id="pl-end"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pl-reason">Reason</Label>
                  <Textarea
                    id="pl-reason"
                    placeholder="Describe the purpose of your leave…"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={4}
                    className="resize-y min-h-[100px]"
                  />
                </div>
                <Button type="submit" disabled={createMutation.isPending} className="min-w-[140px]">
                  {createMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    'Submit request'
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="summary" className="mt-4">
          <Card className="border-border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Your leave requests</CardTitle>
              <p className="text-sm text-muted-foreground font-normal">
                Submitted, approved, and declined requests for your account.
              </p>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center py-12 text-muted-foreground text-sm">Loading…</div>
              ) : leaves.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No leave requests yet. Use <strong>Create personal leave</strong> to add one.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 text-left border-b border-border">
                        <th className="p-3 font-medium">Dates</th>
                        <th className="p-3 font-medium">Type</th>
                        <th className="p-3 font-medium">Reason</th>
                        <th className="p-3 font-medium">Status</th>
                        <th className="p-3 font-medium hidden sm:table-cell">Submitted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaves.map((row) => {
                        const typeLabel =
                          LEAVE_TYPES.find((t) => t.value === row.leave_type)?.label ||
                          row.leave_type ||
                          '—';
                        const st = row.status || 'submitted';
                        return (
                          <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                            <td className="p-3 whitespace-nowrap">
                              {row.start_date} → {row.end_date}
                            </td>
                            <td className="p-3">{typeLabel}</td>
                            <td className="p-3 max-w-[200px] sm:max-w-xs truncate" title={row.reason}>
                              {row.reason}
                            </td>
                            <td className="p-3">
                              <Badge variant="outline" className={statusStyles[st] || statusStyles.submitted}>
                                {statusLabels[st] || st}
                              </Badge>
                            </td>
                            <td className="p-3 text-muted-foreground whitespace-nowrap hidden sm:table-cell">
                              {row.submitted_at
                                ? format(parseISO(row.submitted_at), 'MMM d, yyyy h:mm a')
                                : row.created_date
                                  ? format(parseISO(row.created_date), 'MMM d, yyyy')
                                  : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
