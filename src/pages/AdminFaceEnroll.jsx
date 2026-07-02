import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save } from 'lucide-react';
import FaceCapture from '@/components/face/FaceCapture';
import { faceVerificationApi } from '@/lib/faceVerificationApi';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/CompanyContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';

export default function AdminFaceEnroll() {
  const { user } = useAuth();
  const { activeCompanyId } = useCompany();
  const [params] = useSearchParams();
  const [employeeId, setEmployeeId] = useState(params.get('employee_id') || '');
  const [imageBase64, setImageBase64] = useState('');
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [livenessConfirmed, setLivenessConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const qc = useQueryClient();
  const canAdmin = ['super_admin', 'admin', 'user'].includes(user?.role);

  const statusQuery = useQuery({
    queryKey: ['faceVerificationEnrollStatus', activeCompanyId],
    queryFn: () => faceVerificationApi.status({ scope: 'admin', company_profile_id: activeCompanyId || '' }),
    enabled: !!activeCompanyId && canAdmin,
  });

  const selectedEmployee = useMemo(() =>
    (statusQuery.data?.employees || []).find(employee => employee.employee_id === employeeId),
    [employeeId, statusQuery.data?.employees],
  );

  const enrollMutation = useMutation({
    mutationFn: () => {
      const payload = {
        employeeId,
        employeeRecordId: selectedEmployee?.id,
        companyProfileId: activeCompanyId,
        imageBase64,
        consentAccepted,
        livenessConfirmed,
      };
      return selectedEmployee?.profile
        ? faceVerificationApi.reenroll({ ...payload, profileId: selectedEmployee.profile.id })
        : faceVerificationApi.enroll(payload);
    },
    onSuccess: () => {
      setMessage('Face profile saved.');
      setImageBase64('');
      qc.invalidateQueries({ queryKey: ['faceVerificationAdminStatus'] });
      qc.invalidateQueries({ queryKey: ['faceVerificationEnrollStatus'] });
    },
  });

  if (!canAdmin) {
    return <div className="p-6"><Card className="p-6 text-sm text-muted-foreground">You are not authorized for enrollment.</Card></div>;
  }
  if (statusQuery.data && !statusQuery.data.enabled) {
    return <div className="p-6"><Card className="p-6 text-sm text-muted-foreground">Face Verification is disabled.</Card></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Enroll Face Profile</h1>
          <p className="text-sm text-muted-foreground">Encrypted reference enrollment for standalone verification tests.</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/admin/face-verification"><ArrowLeft className="mr-2 h-4 w-4" />Back</Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="p-4 space-y-4">
          <div>
            <label className="text-sm font-medium">Employee</label>
            <select
              value={employeeId}
              onChange={event => setEmployeeId(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select employee</option>
              {(statusQuery.data?.employees || []).map(employee => (
                <option key={employee.id} value={employee.employee_id}>
                  {employee.employee_name} · {employee.employee_id}
                </option>
              ))}
            </select>
          </div>

          {selectedEmployee && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{selectedEmployee.employee_name}</p>
              <p className="text-muted-foreground">{selectedEmployee.department || 'No department'} · {selectedEmployee.profile?.status || 'not enrolled'}</p>
            </div>
          )}

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Ask the employee to blink and turn their head slightly before capture. Keep the whole face inside the camera guide.
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border p-3">
            <Checkbox checked={consentAccepted} onCheckedChange={checked => setConsentAccepted(Boolean(checked))} />
            <span className="text-sm">Employee consent for biometric enrollment was confirmed.</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border p-3">
            <Checkbox checked={livenessConfirmed} onCheckedChange={checked => setLivenessConfirmed(Boolean(checked))} />
            <span className="text-sm">Employee completed the live blink/head-turn challenge.</span>
          </div>

          {message && <p className="text-sm text-emerald-700">{message}</p>}
          {enrollMutation.error && <p className="text-sm text-destructive">{enrollMutation.error.message}</p>}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => enrollMutation.mutate()}
              disabled={!employeeId || !imageBase64 || !consentAccepted || !livenessConfirmed || enrollMutation.isPending}
            >
              <Save className="mr-2 h-4 w-4" />
              {enrollMutation.isPending ? 'Saving...' : selectedEmployee?.profile ? 'Re-enroll Profile' : 'Enroll Profile'}
            </Button>
            {message && (
              <Button asChild variant="outline">
                <Link to="/admin/face-verification">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Return to Face Verification
                </Link>
              </Button>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <FaceCapture onCapture={setImageBase64} disabled={enrollMutation.isPending} />
        </Card>
      </div>
    </div>
  );
}
