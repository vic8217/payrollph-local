import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, KeyRound, Lock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import PayslipView from '@/components/payroll/PayslipView';
import { useCompany } from '@/lib/CompanyContext';
import {
  fetchEmployeePayrollRecords,
  fetchPayrollPeriodsById,
  isReleasedPayslip,
  payslipReleaseStatus,
} from '@/lib/payslipRecords';
import { Button } from '@/components/ui/button';
import PayslipAcknowledgementDialog from './PayslipAcknowledgementDialog';

const releaseStatusLabels = {
  released: 'Released',
  approved: 'Approved — pending release',
  draft: 'Draft',
  processing: 'Processing',
};

const releaseStatusColors = {
  released: 'bg-emerald-100 text-emerald-700',
  approved: 'bg-green-100 text-green-700',
  draft: 'bg-gray-100 text-gray-600',
  processing: 'bg-amber-100 text-amber-700',
};

export default function EmployeePayslipPanel({ employee }) {
  const [selectedRecordId, setSelectedRecordId] = useState('');
  const [acknowledgementOpen, setAcknowledgementOpen] = useState(false);
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const companyId = employee?.company_profile_id || activeCompanyId;

  const { data: payslipData, isLoading } = useQuery({
    queryKey: ['myPayrollRecords', employee?.employee_id, companyId],
    queryFn: async () => {
      const [allRecords, periodsById] = await Promise.all([
        fetchEmployeePayrollRecords(employee, companyId),
        fetchPayrollPeriodsById(companyId),
      ]);
      return { allRecords, periodsById };
    },
    enabled: !!employee?.employee_id,
  });

  const allRecords = payslipData?.allRecords || [];
  const periodsById = payslipData?.periodsById || {};
  const sorted = useMemo(
    () => [...allRecords].sort((a, b) => (b.created_date || '').localeCompare(a.created_date || '')),
    [allRecords],
  );
  const releasedCount = sorted.filter((record) => isReleasedPayslip(record, periodsById)).length;

  const selectedRecord = sorted.find((record) => String(record.id) === selectedRecordId) || null;
  const selectedReleaseStatus = selectedRecord
    ? payslipReleaseStatus(selectedRecord, periodsById)
    : null;
  const selectedIsReleased = selectedReleaseStatus === 'released';

  useEffect(() => {
    if (sorted.length === 0) {
      setSelectedRecordId('');
      return;
    }

    const stillValid = sorted.some((record) => String(record.id) === selectedRecordId);
    if (!stillValid) {
      setSelectedRecordId(String(sorted[0].id));
    }
  }, [sorted, selectedRecordId]);

  if (!employee) {
    return (
      <div className="p-6 text-center text-muted-foreground text-sm">
        <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
        <p>Scan your QR code first to view your payslips.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground">My Payslips</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {employee.first_name} {employee.last_name} · {employee.department}
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No payslips yet.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="payslip-period">Payroll period</Label>
            <Select value={selectedRecordId} onValueChange={setSelectedRecordId}>
              <SelectTrigger id="payslip-period" className="w-full sm:max-w-md">
                <SelectValue placeholder="Choose a payroll period" />
              </SelectTrigger>
              <SelectContent>
                {sorted.map((record) => {
                  const releaseStatus = payslipReleaseStatus(record, periodsById);
                  return (
                    <SelectItem key={record.id} value={String(record.id)}>
                      {record.period_name} · Net ₱{(record.net_pay || 0).toLocaleString()}
                      {releaseStatus !== 'released' ? ' (not released)' : ''}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {releasedCount} of {sorted.length} period{sorted.length === 1 ? '' : 's'} released for viewing
            </p>
          </div>

          {selectedRecord && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant="outline"
                  className={`text-xs capitalize ${releaseStatusColors[selectedReleaseStatus] || releaseStatusColors.draft}`}
                >
                  {releaseStatusLabels[selectedReleaseStatus] || selectedReleaseStatus}
                </Badge>
              </div>

              {selectedIsReleased ? (
                <>
                  <Card className="border border-border shadow-sm">
                    <CardContent className="p-4">
                      <PayslipView record={selectedRecord} />
                    </CardContent>
                  </Card>
                  {selectedRecord.payslip_acknowledged_at ? (
                    <Card className="border border-emerald-200 bg-emerald-50">
                      <CardContent className="p-4 flex items-start gap-3">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" />
                        <div>
                          <p className="text-sm font-semibold text-emerald-900">Payslip receipt acknowledged</p>
                          <p className="text-xs text-emerald-800">
                            Confirmed on {new Date(selectedRecord.payslip_acknowledged_at).toLocaleString('en-PH')}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  ) : employee.payslip_passkey_set_at ? (
                    <Button className="w-full gap-2" onClick={() => setAcknowledgementOpen(true)}>
                      <CheckCircle2 className="w-4 h-4" /> Acknowledge Receipt of Payslip
                    </Button>
                  ) : (
                    <Card className="border border-amber-200 bg-amber-50">
                      <CardContent className="p-4 flex items-start gap-3">
                        <KeyRound className="w-5 h-5 text-amber-600 mt-0.5" />
                        <div>
                          <p className="text-sm font-semibold text-amber-900">Set your passkey first</p>
                          <p className="text-xs text-amber-800">
                            Return to My Profile and create a four-digit payslip receipt passkey before acknowledging this payslip.
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              ) : (
                <Card className="border border-amber-200 bg-amber-50">
                  <CardContent className="p-6 text-center space-y-2">
                    <Lock className="w-8 h-8 text-amber-600 mx-auto" />
                    <p className="text-sm font-medium text-amber-900">
                      {selectedRecord.period_name} is not released yet
                    </p>
                    <p className="text-xs text-amber-800 max-w-md mx-auto">
                      Payroll has been computed for this period, but HR has not released it to employees yet.
                      Please check back after payroll is released.
                    </p>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {selectedRecord && (
        <PayslipAcknowledgementDialog
          employee={employee}
          record={selectedRecord}
          open={acknowledgementOpen}
          onClose={() => setAcknowledgementOpen(false)}
          onAcknowledged={() => {
            queryClient.invalidateQueries({ queryKey: ['myPayrollRecords', employee?.employee_id, companyId] });
          }}
        />
      )}
    </div>
  );
}
