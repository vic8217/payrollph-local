import { useEffect, useState } from 'react';
import { appApi } from '@/lib/appApi';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import EmployeePayslipPanel from '@/components/employee/EmployeePayslipPanel';

export default function MyPayslip() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    appApi.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: employees = [] } = useQuery({
    queryKey: ['employees'],
    queryFn: () => appApi.entities.Employee.list(),
    enabled: !!user,
  });

  const currentEmployee = employees.find(
    (employee) =>
      String(employee.user_email || '').trim().toLowerCase()
      === String(user?.email || '').trim().toLowerCase(),
  );

  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!currentEmployee) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Card className="border border-amber-200 bg-amber-50">
          <CardContent className="p-5 text-center">
            <FileText className="w-8 h-8 text-amber-500 mx-auto mb-2" />
            <p className="text-sm font-medium text-amber-800">Employee profile not linked</p>
            <p className="text-xs text-amber-700 mt-1">
              Ask HR to link your account email ({user?.email}) to your employee record.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <EmployeePayslipPanel employee={currentEmployee} />;
}
