import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();

    const company = payload.data;
    if (!company) {
      return Response.json({ error: 'No company data in payload' }, { status: 400 });
    }

    const subdomain = company.subdomain || '(not set)';
    const companyName = company.company_name || 'New Company';

    // Get all admin users to notify
    const allUsers = await base44.asServiceRole.entities.User.list();
    const admins = allUsers.filter(u => u.role === 'admin');

    for (const admin of admins) {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: admin.email,
        subject: `New Company Added: ${companyName} — Subdomain Setup Required`,
        body: `
Hello ${admin.full_name || admin.email},

A new company has been added to the system and requires subdomain configuration.

Company Details:
- Name: ${companyName}
- Trade Name: ${company.trade_name || 'N/A'}
- Subdomain: ${subdomain}

Action Required — DNS Setup Steps:
1. Go to your Base44 Dashboard → Domains
2. Click "Add Domain" and enter: ${subdomain}.abaccuz.com
3. Follow the DNS instructions shown to add the required CNAME or A record at your domain registrar (e.g., Namecheap)
4. Wait for DNS propagation (usually 10–60 minutes)

Once configured, this company's portal will be accessible at:
https://${subdomain}.abaccuz.com

This is an automated notification. Please do not reply to this email.
        `.trim(),
      });
    }

    return Response.json({
      success: true,
      message: `Notification sent to ${admins.length} admin(s) for company: ${companyName}`,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});