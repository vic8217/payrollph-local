import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';

export default function EmployeePortalQR() {
  const canvasRef = useRef(null);
  const { activeCompanyId } = useCompany();

  useEffect(() => {
    if (!activeCompanyId) return;
    const portalUrl = new URL('/employee-portal', window.location.origin);
    portalUrl.searchParams.set('company_profile_id', activeCompanyId);
    
    QRCode.toCanvas(canvasRef.current, portalUrl.toString(), {
      width: 800,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });
  }, [activeCompanyId]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = 'employee-portal-qr.png';
    link.click();
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-white gap-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-foreground mb-2">Employee Portal</h1>
        <p className="text-lg text-muted-foreground">Scan QR Code to Access</p>
      </div>
      
      <div className="bg-white p-8 rounded-lg shadow-xl border-4 border-primary">
        <canvas ref={canvasRef} />
      </div>
      
      <Button onClick={handleDownload} className="gap-2">
        <Download className="w-4 h-4" />
        Download QR Code
      </Button>
      
      <p className="text-sm text-muted-foreground max-w-md text-center">
        Use your mobile device or terminal to scan this QR code to access the Employee Portal
      </p>
    </div>
  );
}
