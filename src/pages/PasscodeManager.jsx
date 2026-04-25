import { useState } from 'react';
import { appApi } from '@/lib/appApi';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { KeyRound, RefreshCw, Copy, Check, ShieldAlert, UserCheck, Briefcase } from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const TODAY = format(new Date(), 'yyyy-MM-dd');

function generatePasscode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export default function PasscodeManager() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [copied, setCopied] = useState(''); // 'hr' | 'manager' | ''
  const { activeCompanyId } = useCompany();

  const { data: passcodes = [], isLoading } = useQuery({
    queryKey: ['dailyPasscodes', activeCompanyId],
    queryFn: () => appApi.entities.DailyPasscode.filter({ company_profile_id: activeCompanyId }, '-date', 14),
    enabled: !!activeCompanyId,
  });

  const todayPasscode = passcodes.find(p => p.date === TODAY);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const hrCode = generatePasscode();
      const managerCode = generatePasscode();
      if (todayPasscode) {
        return appApi.entities.DailyPasscode.update(todayPasscode.id, {
          passcode: hrCode,
          manager_passcode: managerCode,
          generated_by: user.email,
        });
      } else {
        return appApi.entities.DailyPasscode.create({
          date: TODAY,
          passcode: hrCode,
          manager_passcode: managerCode,
          generated_by: user.email,
          company_profile_id: activeCompanyId,
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dailyPasscodes'] }),
  });

  const canManagePasscodes = ['super_admin', 'admin'].includes(user?.role);

  // Guard: admins only (after ALL hooks)
  if (!canManagePasscodes) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <ShieldAlert className="w-12 h-12 text-destructive opacity-50" />
        <p className="text-muted-foreground text-sm font-medium">Access restricted to administrators only.</p>
      </div>
    );
  }

  const copyCode = (type) => {
    const code = type === 'hr' ? todayPasscode?.passcode : todayPasscode?.manager_passcode;
    navigator.clipboard.writeText(code || '');
    setCopied(type);
    setTimeout(() => setCopied(''), 2000);
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Daily Passcode</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Generate a daily passcode required for manual attendance edits. Share it with HR officers.
        </p>
      </div>

      {/* Today's Passcode */}
      <Card className="border-2 border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" />
            Today's Passcode — {format(new Date(), 'MMM d, yyyy')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="h-16 flex items-center justify-center">
              <div className="w-6 h-6 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : todayPasscode ? (
            <div className="space-y-3">
              {/* HR Passcode */}
              <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                <UserCheck className="w-4 h-4 text-blue-600 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-medium text-blue-700 mb-0.5">HR Officer Passcode</p>
                  <span className="text-2xl font-mono font-bold tracking-widest text-blue-800">{todayPasscode.passcode}</span>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5 border-blue-200" onClick={() => copyCode('hr')}>
                  {copied === 'hr' ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied === 'hr' ? 'Copied!' : 'Copy'}
                </Button>
              </div>
              {/* Manager Passcode */}
              <div className="flex items-center gap-3 bg-purple-50 border border-purple-200 rounded-lg px-4 py-3">
                <Briefcase className="w-4 h-4 text-purple-600 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-medium text-purple-700 mb-0.5">Manager Passcode</p>
                  <span className="text-2xl font-mono font-bold tracking-widest text-purple-800">{todayPasscode.manager_passcode || '—'}</span>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5 border-purple-200" onClick={() => copyCode('manager')}>
                  {copied === 'manager' ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied === 'manager' ? 'Copied!' : 'Copy'}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No passcode generated for today yet.</p>
          )}

          {todayPasscode && (
            <p className="text-xs text-muted-foreground">
              Generated by: {todayPasscode.generated_by} · Valid for today only
            </p>
          )}

          <Button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${generateMutation.isPending ? 'animate-spin' : ''}`} />
            {todayPasscode ? 'Regenerate Passcode' : 'Generate Passcode'}
          </Button>

          {todayPasscode && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              ⚠️ Regenerating will invalidate the old passcode. Anyone using the old code will be blocked.
            </div>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3">Recent History</h2>
        <div className="space-y-2">
          {passcodes.filter(p => p.date !== TODAY).slice(0, 7).map(p => (
            <div key={p.id} className="flex items-center justify-between px-4 py-2.5 bg-card border border-border rounded-lg">
              <div>
                <span className="text-sm text-foreground font-medium">{p.date}</span>
                <span className="text-xs text-muted-foreground ml-3">by {p.generated_by}</span>
              </div>
              <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
                {p.passcode}
              </Badge>
            </div>
          ))}
          {passcodes.filter(p => p.date !== TODAY).length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No previous passcodes.</p>
          )}
        </div>
      </div>
    </div>
  );
}
