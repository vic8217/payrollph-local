import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock3, KeyRound, Search, UserRoundX } from 'lucide-react';
import { appApi } from '@/lib/appApi';
import { useCompany } from '@/lib/CompanyContext';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default function PayslipAcknowledgements() {
  const { activeCompanyId } = useCompany();
  const [search, setSearch] = useState('');

  const { data: employees = [], isLoading: loadingEmployees } = useQuery({
    queryKey: ['employees', activeCompanyId, 'payslip-passkeys'],
    queryFn: () => appApi.entities.Employee.filter({ company_profile_id: activeCompanyId }),
    enabled: !!activeCompanyId,
  });
  const { data: payrollRecords = [], isLoading: loadingRecords } = useQuery({
    queryKey: ['payroll-records', activeCompanyId, 'acknowledgements'],
    queryFn: () => appApi.entities.PayrollRecord.filter({ company_profile_id: activeCompanyId }, '-created_date', 5000),
    enabled: !!activeCompanyId,
  });
  const { data: periods = [] } = useQuery({
    queryKey: ['payroll-periods', activeCompanyId, 'acknowledgements'],
    queryFn: () => appApi.entities.PayrollPeriod.filter({ company_profile_id: activeCompanyId }, '-end_date', 1000),
    enabled: !!activeCompanyId,
  });

  const periodById = useMemo(
    () => Object.fromEntries(periods.map(period => [String(period.id), period])),
    [periods],
  );
  const activeEmployees = employees.filter(employee => employee.status !== 'inactive');
  const missingPasskeys = activeEmployees.filter(employee => !employee.payslip_passkey_set_at);
  const releasedRecords = payrollRecords.filter(record =>
    record.status === 'released' || periodById[String(record.payroll_period_id)]?.status === 'released'
  );
  const pendingReceipts = releasedRecords.filter(record => !record.payslip_acknowledged_at);
  const acknowledgedReceipts = releasedRecords.filter(record => record.payslip_acknowledged_at);
  const query = search.trim().toLowerCase();
  const matches = value => !query || String(value || '').toLowerCase().includes(query);

  const visibleMissing = missingPasskeys.filter(employee =>
    matches(`${employee.first_name} ${employee.middle_name || ''} ${employee.last_name}`)
    || matches(employee.employee_id)
    || matches(employee.department)
  );
  const visibleRecords = releasedRecords.filter(record =>
    matches(record.employee_name) || matches(record.employee_id) || matches(record.period_name)
  );

  const loading = loadingEmployees || loadingRecords;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Payslip Receipt Monitoring</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor employee passkey setup and acknowledgement of released payslips.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4 flex items-center gap-3">
          <UserRoundX className="w-6 h-6 text-amber-600" />
          <div><p className="text-2xl font-bold">{missingPasskeys.length}</p><p className="text-xs text-muted-foreground">Passkeys not set</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <Clock3 className="w-6 h-6 text-orange-600" />
          <div><p className="text-2xl font-bold">{pendingReceipts.length}</p><p className="text-xs text-muted-foreground">Receipts pending</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <CheckCircle2 className="w-6 h-6 text-emerald-600" />
          <div><p className="text-2xl font-bold">{acknowledgedReceipts.length}</p><p className="text-xs text-muted-foreground">Receipts acknowledged</p></div>
        </CardContent></Card>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
        <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search employee or payroll period" className="pl-9" />
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="p-4 border-b border-border">
                <h2 className="font-semibold flex items-center gap-2"><KeyRound className="w-4 h-4" /> Employees Without Passkeys</h2>
              </div>
              {visibleMissing.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground text-center">All matching active employees have configured passkeys.</p>
              ) : (
                <div className="divide-y divide-border">
                  {visibleMissing.map(employee => (
                    <div key={employee.id} className="p-4 flex justify-between gap-4">
                      <div>
                        <p className="font-medium text-sm">{employee.first_name} {employee.middle_name} {employee.last_name}</p>
                        <p className="text-xs text-muted-foreground">{employee.employee_id} · {employee.department || 'No department'}</p>
                      </div>
                      <Badge className="bg-amber-100 text-amber-700 border-0">Not set</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <div className="p-4 border-b border-border">
                <h2 className="font-semibold">Released Payslip Acknowledgements</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="p-3">Employee</th>
                    <th className="p-3">Payroll Period</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Acknowledged At</th>
                    <th className="p-3">Photo</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRecords.map(record => (
                    <tr key={record.id} className="border-b border-border last:border-0">
                      <td className="p-3"><p className="font-medium">{record.employee_name}</p><p className="text-xs text-muted-foreground">{record.employee_id}</p></td>
                      <td className="p-3">{record.period_name}</td>
                      <td className="p-3">
                        {record.payslip_acknowledged_at
                          ? <Badge className="bg-emerald-100 text-emerald-700 border-0">Acknowledged</Badge>
                          : <Badge className="bg-orange-100 text-orange-700 border-0">Pending</Badge>}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {record.payslip_acknowledged_at
                          ? new Date(record.payslip_acknowledged_at).toLocaleString('en-PH')
                          : '—'}
                      </td>
                      <td className="p-3">
                        {record.payslip_acknowledgement_photo_url
                          ? <a href={record.payslip_acknowledgement_photo_url} target="_blank" rel="noreferrer"><img src={record.payslip_acknowledgement_photo_url} alt="Employee receipt" className="w-12 h-10 rounded object-cover border border-border" /></a>
                          : '—'}
                      </td>
                    </tr>
                  ))}
                  {visibleRecords.length === 0 && (
                    <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No released payslips match the search.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
