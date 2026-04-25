import { useState } from 'react';
import { appApi } from '@/lib/appApi';
import { useQuery } from '@tanstack/react-query';
import { FileText, AlertCircle, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

export default function Employee201File({ employee }) {
  const [activeTab, setActiveTab] = useState('profile');

  const { data: cashAdvances = [] } = useQuery({
    queryKey: ['cashAdvances', employee.employee_id],
    queryFn: () => appApi.entities.CashAdvance.filter({ employee_id: employee.employee_id }),
  });

  const handleDownload = () => {
    const data = {
      'Employee ID': employee.employee_id,
      'Full Name': `${employee.first_name} ${employee.last_name}`,
      'Department': employee.department || '—',
      'Position': employee.position || '—',
      'Employment Type': (employee.employment_type || '—').replace('_', ' '),
      'Status': employee.status,
      'Daily Rate': employee.daily_rate || 0,
      'Date Hired': employee.date_hired || '—',
      'Email': employee.email || '—',
      'Phone': employee.phone || '—',
      'SSS Number': employee.sss_number || '—',
      'PhilHealth Number': employee.philhealth_number || '—',
      'Pag-IBIG Number': employee.pagibig_number || '—',
      'TIN Number': employee.tin_number || '—',
    };

    const csv = Object.keys(data).map(key => `"${key}","${data[key]}"`).join('\n');
    const header = Object.keys(data).map(k => `"${k}"`).join(',');
    const fullCsv = header + '\n' + csv;

    const blob = new Blob([fullCsv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `201-file-${employee.employee_id}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const tabs = [
    { id: 'profile', label: 'Profile', icon: '👤' },
    { id: 'cash-advances', label: 'Cash Advances', icon: '💰' },
    { id: 'memos', label: 'Memos', icon: '📋' },
    { id: 'suspension', label: 'Suspension', icon: '⛔' },
    { id: 'termination', label: 'Termination', icon: '📄' },
    { id: 'promissory', label: 'Promissory Notes', icon: '✍️' },
  ];

  return (
    <div className="space-y-4">
      {/* Download Button */}
      <div className="flex justify-end">
        <Button onClick={handleDownload} variant="outline" size="sm" className="gap-2">
          <Download className="w-4 h-4" />
          Download CSV
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-border overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="mr-1">{tab.icon}</span>
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-96">
        {activeTab === 'profile' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground font-medium">Employee ID</p>
                <p className="text-sm font-medium text-foreground">{employee.employee_id}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Status</p>
                <Badge className="mt-1 capitalize">{employee.status}</Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Full Name</p>
                <p className="text-sm font-medium text-foreground">{employee.first_name} {employee.last_name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Department</p>
                <p className="text-sm font-medium text-foreground">{employee.department || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Position</p>
                <p className="text-sm font-medium text-foreground">{employee.position || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Employment Type</p>
                <p className="text-sm font-medium text-foreground capitalize">{(employee.employment_type || '—').replace('_', ' ')}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Daily Rate</p>
                <p className="text-sm font-medium text-foreground">₱{(employee.daily_rate || 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Date Hired</p>
                <p className="text-sm font-medium text-foreground">{employee.date_hired || '—'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground font-medium">Email</p>
                <p className="text-sm font-medium text-foreground">{employee.email || '—'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground font-medium">Phone</p>
                <p className="text-sm font-medium text-foreground">{employee.phone || '—'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground font-medium">SSS Number</p>
                <p className="text-sm font-medium text-foreground">{employee.sss_number || '—'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground font-medium">PhilHealth Number</p>
                <p className="text-sm font-medium text-foreground">{employee.philhealth_number || '—'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground font-medium">Pag-IBIG Number</p>
                <p className="text-sm font-medium text-foreground">{employee.pagibig_number || '—'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground font-medium">TIN Number</p>
                <p className="text-sm font-medium text-foreground">{employee.tin_number || '—'}</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'cash-advances' && (
          <div className="space-y-3">
            {cashAdvances.length === 0 ? (
              <p className="text-muted-foreground text-sm py-8">No cash advances recorded.</p>
            ) : (
              cashAdvances.map(advance => (
                <Card key={advance.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                         <p className="font-medium text-sm text-foreground">₱{advance.amount_approved || advance.amount_requested}</p>
                         <Badge className="text-xs capitalize">{advance.status}</Badge>
                       </div>
                      <p className="text-xs text-muted-foreground mt-1">{advance.reason}</p>
                      <p className="text-xs text-muted-foreground">Requested: {advance.request_date}</p>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        )}

        {activeTab === 'memos' && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <AlertCircle className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">No memos issued.</p>
          </div>
        )}

        {activeTab === 'suspension' && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <AlertCircle className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">No suspension documents.</p>
          </div>
        )}

        {activeTab === 'termination' && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <FileText className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">No termination documents.</p>
          </div>
        )}

        {activeTab === 'promissory' && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <FileText className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">No promissory notes.</p>
          </div>
        )}
      </div>
    </div>
  );
}