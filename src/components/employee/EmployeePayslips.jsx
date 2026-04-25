import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { appApi } from '@/lib/appApi';
import { FileText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import PayslipView from '@/components/payroll/PayslipView';

const statusColors = {
  draft: 'bg-gray-100 text-gray-600',
  approved: 'bg-green-100 text-green-700',
  released: 'bg-emerald-100 text-emerald-700',
};

export default function EmployeePayslips({ employee }) {
  const [selectedRecord, setSelectedRecord] = useState(null);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['myPayrollRecords', employee?.employee_id],
    queryFn: () => appApi.entities.PayrollRecord.filter({ employee_id: employee.employee_id, status: 'released' }),
    enabled: !!employee,
  });

  const sorted = [...records].sort((a, b) => (b.created_date || '').localeCompare(a.created_date || ''));

  if (!employee) return (
    <div className="p-6 text-center text-muted-foreground text-sm">
      <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
      <p>Scan your QR code first to view your payslips.</p>
    </div>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <h2 className="text-xl font-bold text-foreground">My Payslips</h2>
      <p className="text-sm text-muted-foreground -mt-3">{employee.first_name} {employee.last_name} · {employee.department}</p>

      {isLoading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">No payslips yet.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            {sorted.map(rec => (
              <button
                key={rec.id}
                onClick={() => setSelectedRecord(rec)}
                className={`w-full text-left p-4 rounded-xl border transition-all ${selectedRecord?.id === rec.id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/40'}`}
              >
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm text-foreground">{rec.period_name}</p>
                  <Badge variant="outline" className={`text-xs capitalize ${statusColors[rec.status]}`}>{rec.status}</Badge>
                </div>
                <div className="flex justify-between mt-2">
                  <span className="text-xs text-muted-foreground">Gross: ₱{(rec.gross_pay || 0).toLocaleString()}</span>
                  <span className="text-sm font-bold text-primary">₱{(rec.net_pay || 0).toLocaleString()}</span>
                </div>
              </button>
            ))}
          </div>
          <div>
            {selectedRecord ? (
              <Card><CardContent className="p-4"><PayslipView record={selectedRecord} /></CardContent></Card>
            ) : (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground border border-dashed rounded-xl">
                <FileText className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">Select a payslip to view</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}