import { useState, useEffect } from 'react';
import { appApi } from '@/lib/appApi';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import PayslipView from '@/components/payroll/PayslipView';

export default function MyPayslip() {
  const [user, setUser] = useState(null);
  const [selectedRecord, setSelectedRecord] = useState(null);

  useEffect(() => { appApi.auth.me().then(setUser).catch(() => {}); }, []);

  const { data: employees = [] } = useQuery({
    queryKey: ['employees'],
    queryFn: () => appApi.entities.Employee.list(),
    enabled: !!user,
  });

  const currentEmployee = employees.find(e => e.user_email === user?.email);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['myPayrollRecords', currentEmployee?.employee_id],
    queryFn: () => appApi.entities.PayrollRecord.filter({ employee_id: currentEmployee.employee_id, status: 'released' }),
    enabled: !!currentEmployee,
  });

  const sorted = [...records].sort((a, b) => (b.created_date || '').localeCompare(a.created_date || ''));

  const statusColors = {
    draft: 'bg-gray-100 text-gray-600',
    approved: 'bg-green-100 text-green-700',
    released: 'bg-emerald-100 text-emerald-700',
  };

  if (!user) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Payslips</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          {currentEmployee ? `${currentEmployee.first_name} ${currentEmployee.last_name} · ${currentEmployee.department}` : 'Your payroll history'}
        </p>
      </div>

      {!currentEmployee ? (
        <Card className="border border-amber-200 bg-amber-50">
          <CardContent className="p-5 text-center">
            <FileText className="w-8 h-8 text-amber-500 mx-auto mb-2" />
            <p className="text-sm font-medium text-amber-800">Employee profile not linked</p>
            <p className="text-xs text-amber-700 mt-1">Ask HR to link your account email ({user?.email}) to your employee record.</p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">No payslips yet.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Payslip List */}
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

          {/* Payslip Detail */}
          <div>
            {selectedRecord ? (
              <Card className="border border-border shadow-sm">
                <CardContent className="p-4">
                  <PayslipView record={selectedRecord} />
                </CardContent>
              </Card>
            ) : (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground border border-dashed border-border rounded-xl">
                <FileText className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">Select a payslip to view details</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
