import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { appApi } from '@/lib/appApi';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';

const S = {
  card: { width: '54mm', height: '85.6mm', fontFamily: 'Inter, sans-serif', background: '#fff', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box' },
  banner: { background: 'linear-gradient(135deg, #1d4ed8, #1e3a8a)', padding: '10px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  bannerTitle: { color: '#fff', fontWeight: 800, fontSize: '13px', letterSpacing: '3px', margin: 0 },
  bannerSub: { color: '#93c5fd', fontSize: '6px', letterSpacing: '2.5px', textTransform: 'uppercase', margin: '2px 0 0' },
  photoRow: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px 0' },
  photoWrap: { width: '72px', height: '72px', borderRadius: '50%', overflow: 'hidden', border: '3px solid #fff', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', flexShrink: 0, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  photo: { width: '100%', height: '100%', objectFit: 'cover' },
  nameCol: { display: 'flex', flexDirection: 'column' },
  name: { fontWeight: 700, fontSize: '11px', color: '#111827', margin: 0, lineHeight: 1.2 },
  position: { fontSize: '8px', color: '#1d4ed8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', margin: '2px 0 0' },
  dept: { fontSize: '7px', color: '#9ca3af', margin: '2px 0 0' },
  divider: { margin: '6px 14px', borderTop: '1px dashed #e5e7eb' },
  details: { padding: '0 14px', display: 'flex', flexDirection: 'column', gap: '3px' },
  detailRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  detailLabel: { fontSize: '6px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '1px' },
  detailValue: { fontSize: '8px', color: '#1f2937', fontWeight: 700, fontFamily: 'monospace' },
  detailValueNormal: { fontSize: '8px', color: '#374151' },
  qrWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 'auto', marginBottom: '6px' },
  qrLabel: { fontSize: '6px', color: '#9ca3af', letterSpacing: '2px', textTransform: 'uppercase', marginTop: '2px' },
  strip: { height: '6px', background: 'linear-gradient(90deg, #1d4ed8, #1e3a8a)', marginTop: 'auto' },
  // Back side
  backContent: { flex: 1, padding: '8px 10px 4px', overflow: 'hidden' },
  backHeader: { display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px' },
  backHeaderText: { fontSize: '7px', fontWeight: 800, color: '#111827', margin: 0 },
  sectionTitle: { fontSize: '6.5px', fontWeight: 700, color: '#1d4ed8', textDecoration: 'underline', margin: '0 0 3px' },
  bodyText: { fontSize: '6px', color: '#374151', margin: '0 0 2px' },
  bullet: { fontSize: '6px', color: '#374151', display: 'flex', gap: '3px', marginBottom: '2px' },
  pinText: { fontSize: '6px', fontWeight: 700, color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '2px', margin: '2px 0' },
  warning: { background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '4px', padding: '5px 8px', textAlign: 'center', marginTop: '6px' },
  warningText: { fontSize: '6px', fontWeight: 600, color: '#92400e', margin: 0 },
};

export default function EmployeeIdCard({ employee }) {
  const qrRef = useRef(null);
  const [company, setCompany] = useState(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const qrValue = employee?.employee_id || employee?.qr_code?.replace(/-PayrollPH$/i, '');

  useEffect(() => {
    appApi.entities.CompanyProfile.list().then(list => { if (list?.length > 0) setCompany(list[0]); });
  }, []);

  useEffect(() => {
    setLogoFailed(false);
  }, [company?.logo_url]);

  useEffect(() => {
    if (qrRef.current && qrValue) {
      QRCode.toCanvas(qrRef.current, qrValue, {
        width: 120,
        margin: 1,
        color: { dark: '#1e3a5f', light: '#ffffff' },
      });
    }
  }, [qrValue]);

  const getFrontHTML = () => {
    const canvas = qrRef.current;
    const qrDataUrl = canvas ? canvas.toDataURL() : null;
    const photoHtml = employee?.photo_url
      ? `<img src="${employee.photo_url}" style="width:100%;height:100%;object-fit:cover;" />`
      : `<span style="color:#1d4ed8;font-size:16px;font-weight:700;">${(employee?.first_name?.[0] || '') + (employee?.last_name?.[0] || '')}</span>`;
    const qrHtml = qrDataUrl
      ? `<img src="${qrDataUrl}" style="width:120px;height:120px;border-radius:4px;" />`
      : `<div style="width:64px;height:64px;border:2px dashed #d1d5db;border-radius:4px;display:flex;align-items:center;justify-content:center;"><span style="font-size:7px;color:#9ca3af;">No QR</span></div>`;
    const companyName = company?.trade_name || company?.company_name || 'PayrollPH';
    const logoHtml = company?.logo_url && !logoFailed
      ? `<img src="${company.logo_url}" style="height:28px;max-width:100px;object-fit:contain;margin-bottom:2px;" />`
      : `<p style="color:#fff;font-weight:800;font-size:13px;letter-spacing:3px;margin:0;">${companyName}</p>`;

    return `
      <div style="width:54mm;height:85.6mm;font-family:Inter,sans-serif;background:#fff;display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;">
        <div style="background:linear-gradient(135deg,#1d4ed8,#1e3a8a);padding:10px 12px;display:flex;flex-direction:column;align-items:center;">
          ${logoHtml}
          <p style="color:#93c5fd;font-size:6px;letter-spacing:2.5px;text-transform:uppercase;margin:2px 0 0;">Employee ID Card</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px 0;">
          <div style="width:72px;height:72px;border-radius:50%;overflow:hidden;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.15);flex-shrink:0;background:#eff6ff;display:flex;align-items:center;justify-content:center;">
            ${photoHtml}
          </div>
          <div style="display:flex;flex-direction:column;">
            <p style="font-weight:700;font-size:11px;color:#111827;margin:0;line-height:1.2;">${employee?.first_name || ''} ${employee?.middle_name ? employee.middle_name[0] + '. ' : ''}${employee?.last_name || ''}</p>
            <p style="font-size:8px;color:#1d4ed8;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin:2px 0 0;">${employee?.position || '—'}</p>
            <p style="font-size:7px;color:#9ca3af;margin:2px 0 0;">${employee?.department || ''}</p>
          </div>
        </div>
        <div style="margin:6px 14px;border-top:1px dashed #e5e7eb;"></div>
        <div style="padding:0 14px;display:flex;flex-direction:column;gap:3px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:6px;color:#9ca3af;text-transform:uppercase;font-weight:600;letter-spacing:1px;">ID No.</span>
            <span style="font-size:8px;color:#1f2937;font-weight:700;font-family:monospace;">${employee?.employee_id || ''}</span>
          </div>
          ${employee?.employment_type ? `<div style="display:flex;justify-content:space-between;align-items:center;"><span style="font-size:6px;color:#9ca3af;text-transform:uppercase;font-weight:600;letter-spacing:1px;">Type</span><span style="font-size:8px;color:#374151;">${employee.employment_type.replace('_', ' ')}</span></div>` : ''}
          ${employee?.date_hired ? `<div style="display:flex;justify-content:space-between;align-items:center;"><span style="font-size:6px;color:#9ca3af;text-transform:uppercase;font-weight:600;letter-spacing:1px;">Since</span><span style="font-size:8px;color:#374151;">${employee.date_hired}</span></div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;margin-top:auto;margin-bottom:6px;">
          ${qrHtml}
          <p style="font-size:6px;color:#9ca3af;letter-spacing:2px;text-transform:uppercase;margin-top:2px;">Scan for Attendance</p>
        </div>
        <div style="height:6px;background:linear-gradient(90deg,#1d4ed8,#1e3a8a);"></div>
      </div>`;
  };

  const getBackHTML = () => {
    const companyName = company?.trade_name || company?.company_name || 'PayrollPH';
    const logoHtml = company?.logo_url && !logoFailed
      ? `<img src="${company.logo_url}" style="height:28px;max-width:100px;object-fit:contain;margin-bottom:2px;" />`
      : `<p style="color:#fff;font-weight:800;font-size:13px;letter-spacing:3px;margin:0;">${companyName}</p>`;
    return `
    <div style="width:54mm;height:85.6mm;font-family:Inter,sans-serif;background:#fff;display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;">
      <div style="background:linear-gradient(135deg,#1d4ed8,#1e3a8a);padding:10px 12px;display:flex;flex-direction:column;align-items:center;">
        ${logoHtml}
        <p style="color:#93c5fd;font-size:6px;letter-spacing:2px;text-transform:uppercase;margin:2px 0 0;">Attendance Policy</p>
      </div>
      <div style="flex:1;padding:8px 10px 4px;overflow:hidden;">
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:6px;">
          <span>⚖️</span>
          <p style="font-size:7px;font-weight:800;color:#111827;margin:0;">Applicable Laws (Philippines)</p>
        </div>
        <div style="margin-bottom:6px;">
          <p style="font-size:6.5px;font-weight:700;color:#1d4ed8;text-decoration:underline;margin:0 0 3px;">1. Labor Code of the Philippines</p>
          <p style="font-size:6px;color:#374151;margin:0 0 2px;">Employers may <strong>discipline or terminate</strong> employees for:</p>
          <div style="padding-left:8px;">
            <div style="font-size:6px;color:#374151;display:flex;gap:3px;margin-bottom:2px;"><span>•</span><span>Serious misconduct</span></div>
            <div style="font-size:6px;color:#374151;display:flex;gap:3px;margin-bottom:2px;"><span>•</span><span>Fraud or willful breach of trust</span></div>
            <div style="font-size:6px;color:#374151;display:flex;gap:3px;margin-bottom:2px;"><span>•</span><span>"Buddy punching" (signing for another) — <strong>fraud / dishonesty</strong></span></div>
          </div>
        </div>
        <div style="margin-bottom:6px;">
          <p style="font-size:6.5px;font-weight:700;color:#1d4ed8;text-decoration:underline;margin:0 0 3px;">2. Revised Penal Code</p>
          <p style="font-size:6px;color:#374151;margin:0 0 2px;">Possible criminal liability:</p>
          <p style="font-size:6px;font-weight:700;color:#b91c1c;margin:2px 0;">📌 Article 172 – Falsification of Private Documents</p>
          <div style="padding-left:8px;">
            <div style="font-size:6px;color:#374151;display:flex;gap:3px;margin-bottom:2px;"><span>•</span><span>If time records (DTR, logbook) are falsified</span></div>
            <div style="font-size:6px;color:#374151;display:flex;gap:3px;margin-bottom:2px;"><span>•</span><span>Penalty: <strong>Prisión correccional</strong> (6 months – 6 years) + possible <strong>fine</strong></span></div>
          </div>
        </div>
        <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:4px;padding:5px 8px;text-align:center;margin-top:6px;">
          <p style="font-size:6px;font-weight:600;color:#92400e;margin:0;">⚠️ By scanning, you confirm this is your own attendance record.</p>
        </div>
      </div>
      <div style="height:6px;background:linear-gradient(90deg,#1d4ed8,#1e3a8a);"></div>
    </div>`;
  };

  const handlePrint = (side) => {
    const html = side === 'front' ? getFrontHTML() : getBackHTML();
    const win = window.open('', '_blank', 'width=300,height=450');
    win.document.write(`<!DOCTYPE html><html><head>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
      <style>* { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; } body { width:54mm; } @page { size:54mm 85.6mm; margin:0; }</style>
    </head><body>${html}</body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); win.close(); };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>

      {/* FRONT preview */}
      <div id="id-card-front" style={{ ...S.card, borderRadius: '16px', boxShadow: '0 8px 32px rgba(0,0,0,0.15)', border: '1px solid #e5e7eb' }}>
        <div style={S.banner}>
          {company?.logo_url && !logoFailed
            ? <img src={company.logo_url} alt="logo" onError={() => setLogoFailed(true)} style={{ height: '28px', maxWidth: '100px', objectFit: 'contain', marginBottom: '2px' }} />
            : <p style={S.bannerTitle}>{company?.trade_name || company?.company_name || 'PayrollPH'}</p>
          }
          <p style={S.bannerSub}>Employee ID Card</p>
        </div>
        <div style={S.photoRow}>
          <div style={S.photoWrap}>
            {employee?.photo_url
              ? <img src={employee.photo_url} alt="Employee" style={S.photo} />
              : <span style={{ color: '#1d4ed8', fontSize: '16px', fontWeight: 700 }}>{employee?.first_name?.[0]}{employee?.last_name?.[0]}</span>
            }
          </div>
          <div style={S.nameCol}>
            <p style={S.name}>{employee?.first_name} {employee?.middle_name ? employee.middle_name[0] + '. ' : ''}{employee?.last_name}</p>
            <p style={S.position}>{employee?.position || '—'}</p>
            <p style={S.dept}>{employee?.department}</p>
          </div>
        </div>
        <div style={S.divider} />
        <div style={S.details}>
          <div style={S.detailRow}>
            <span style={S.detailLabel}>ID No.</span>
            <span style={S.detailValue}>{employee?.employee_id}</span>
          </div>
          {employee?.employment_type && (
            <div style={S.detailRow}>
              <span style={S.detailLabel}>Type</span>
              <span style={S.detailValueNormal}>{employee.employment_type.replace('_', ' ')}</span>
            </div>
          )}
          {employee?.date_hired && (
            <div style={S.detailRow}>
              <span style={S.detailLabel}>Since</span>
              <span style={S.detailValueNormal}>{employee.date_hired}</span>
            </div>
          )}
        </div>
        <div style={S.qrWrap}>
          {qrValue
            ? <canvas ref={qrRef} style={{ borderRadius: '4px' }} />
            : <div style={{ width: 64, height: 64, border: '2px dashed #d1d5db', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontSize: '7px', color: '#9ca3af' }}>No QR</span></div>
          }
          <p style={S.qrLabel}>Scan for Attendance</p>
        </div>
        <div style={S.strip} />
      </div>

      {/* BACK preview */}
      <div id="id-card-back" style={{ ...S.card, borderRadius: '16px', boxShadow: '0 8px 32px rgba(0,0,0,0.15)', border: '1px solid #e5e7eb' }}>
        <div style={S.banner}>
          {company?.logo_url && !logoFailed
            ? <img src={company.logo_url} alt="logo" onError={() => setLogoFailed(true)} style={{ height: '28px', maxWidth: '100px', objectFit: 'contain', marginBottom: '2px' }} />
            : <p style={S.bannerTitle}>{company?.trade_name || company?.company_name || 'PayrollPH'}</p>
          }
          <p style={{ ...S.bannerSub, letterSpacing: '2px' }}>Attendance Policy</p>
        </div>
        <div style={S.backContent}>
          <div style={S.backHeader}>
            <span style={{ fontSize: '7px' }}>⚖️</span>
            <p style={S.backHeaderText}>Applicable Laws (Philippines)</p>
          </div>
          <div style={{ marginBottom: '6px' }}>
            <p style={S.sectionTitle}>1. Labor Code of the Philippines</p>
            <p style={S.bodyText}>Employers may <strong>discipline or terminate</strong> employees for:</p>
            <div style={{ paddingLeft: '8px' }}>
              {['Serious misconduct', 'Fraud or willful breach of trust', '"Buddy punching" (signing for another) — fraud / dishonesty'].map((item, i) => (
                <div key={i} style={S.bullet}><span>•</span><span>{item}</span></div>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: '6px' }}>
            <p style={S.sectionTitle}>2. Revised Penal Code</p>
            <p style={S.bodyText}>Possible criminal liability:</p>
            <p style={S.pinText}><span>📌</span> Article 172 – Falsification of Private Documents</p>
            <div style={{ paddingLeft: '8px' }}>
              <div style={S.bullet}><span>•</span><span>If time records (DTR, logbook) are falsified</span></div>
              <div style={S.bullet}><span>•</span><span>Penalty: <strong>Prisión correccional</strong> (6 months – 6 years) + possible <strong>fine</strong></span></div>
            </div>
          </div>
          <div style={S.warning}>
            <p style={S.warningText}>⚠️ By scanning, you confirm this is your own attendance record.</p>
          </div>
        </div>
        <div style={S.strip} />
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <Button onClick={() => handlePrint('front')} className="gap-2">
          <Printer className="w-4 h-4" /> Print Front
        </Button>
        <Button onClick={() => handlePrint('back')} variant="outline" className="gap-2">
          <Printer className="w-4 h-4" /> Print Back
        </Button>
      </div>
    </div>
  );
}
