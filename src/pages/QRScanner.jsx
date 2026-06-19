import EmployeeQRGate from '@/components/employee/EmployeeQRGate';
import { useCompany } from '@/lib/CompanyContext';

export default function QRScanner() {
  const { activeCompanyId } = useCompany();

  return (
    <EmployeeQRGate
      companyProfileId={activeCompanyId}
      title="QR Scanner"
      description="Scan an employee QR code to record attendance"
    />
  );
}
