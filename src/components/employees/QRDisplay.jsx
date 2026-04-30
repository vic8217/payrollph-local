import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

export default function QRDisplay({ employee }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const value = employee.employee_id || employee.qr_code?.replace(/-PayrollPH$/i, '') || 'UNKNOWN';
    QRCode.toCanvas(canvas, value, {
      width: 200,
      margin: 2,
      color: {
        dark: '#16a34a',  // green-600
        light: '#ffffff',
      },
    });
  }, [employee]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `QR-${employee.employee_id}.png`;
    a.click();
  };

  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <div className="p-4 bg-white border border-border rounded-xl shadow-sm">
        <canvas ref={canvasRef} className="rounded" />
      </div>
      <div className="text-center">
        <p className="font-semibold text-foreground">{employee.first_name} {employee.last_name}</p>
        <p className="text-sm text-muted-foreground">{employee.employee_id} · {employee.department}</p>
        <p className="text-xs text-muted-foreground mt-1 font-mono bg-muted px-2 py-1 rounded">{employee.employee_id}</p>
      </div>
      <Button variant="outline" size="sm" onClick={handleDownload} className="gap-2">
        <Download className="w-4 h-4" /> Download QR
      </Button>
    </div>
  );
}
