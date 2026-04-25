import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { code } = await req.json();

    if (!code) {
      return Response.json({ error: 'Missing code' }, { status: 400 });
    }

    const trimmed = code.trim().replace(/[\u200B-\u200D\uFEFF]/g, '');

    // Use service role since employee portal is public (no login required)
    const byId = await base44.asServiceRole.entities.Employee.filter({ employee_id: trimmed, status: 'active' });
    let emp = byId[0];

    if (!emp) {
      const byQr = await base44.asServiceRole.entities.Employee.filter({ qr_code: trimmed, status: 'active' });
      emp = byQr[0];
    }

    if (!emp) {
      return Response.json({ found: false });
    }

    return Response.json({ found: true, employee: emp });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});