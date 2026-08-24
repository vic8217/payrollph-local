// @ts-nocheck
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { prisma } from '@/server/prisma';
import { listRecords } from '@/server/entityStore';
import { payrollReconciliationReadiness } from '@/server/payrollReconciliationReadiness';

const STATUSES = new Set(['needs_response', 'responded', 'resolved', 'reopened']);
const reviewer = user => user?.role === 'super_admin';
const responder = user => ['super_admin', 'admin', 'user'].includes(user?.role);
const assignedCompanies = user => user?.role === 'super_admin' ? null : (user?.company_profile_ids || (user?.company_profile_id ? [user.company_profile_id] : []));
const canAccessCompany = (user, companyId) => user?.role === 'super_admin' || assignedCompanies(user).includes(companyId);
const fail = (res, status, error) => res.status(status).json({ error });
const actor = user => ({ actorUserId: user.id, actorRole: user.role });

async function noteForUser(id, user) {
  const note = await prisma.payrollReconciliationReviewerNote.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: 'asc' } } } });
  if (!note || !canAccessCompany(user, note.companyProfileId)) {
    const error = new Error('Reviewer note not found.'); error.status = 404; throw error;
  }
  return note;
}

async function validateScope(data, user) {
  const companyId = String(data.companyProfileId || '');
  if (!companyId || !canAccessCompany(user, companyId)) throw Object.assign(new Error('You do not have access to this company.'), { status: 403 });
  const [period] = await listRecords('PayrollPeriod', { filter: { id: data.payrollPeriodId, company_profile_id: companyId }, limit: 1 });
  const [employee] = await listRecords('Employee', { filter: { employee_id: data.employeeId, company_profile_id: companyId }, limit: 1 });
  const [reconciliation] = data.reconciliationId ? await listRecords('PayrollReconciliation', { filter: { id: data.reconciliationId, company_profile_id: companyId, payroll_period_id: data.payrollPeriodId, employee_id: data.employeeId }, limit: 1 }) : [null];
  if (!period || !employee || (data.reconciliationId && !reconciliation)) throw Object.assign(new Error('Invalid payroll-period, employee, or reconciliation scope.'), { status: 400 });
  return reconciliation;
}

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  const user = session?.user;
  if (!user) return fail(res, 401, 'Authentication is required.');
  const input = req.method === 'GET' ? req.query : req.body || {};
  const action = input.action || (req.method === 'GET' ? 'list' : '');
  try {
    if (action === 'list' || action === 'summary' || action === 'review-summary') {
      if (action === 'review-summary' && !reviewer(user)) return fail(res, 403, 'Only a Super Admin can view the reviewer summary.');
      const companyProfileId = String(input.companyProfileId || '');
      if (!canAccessCompany(user, companyProfileId)) return fail(res, 403, 'You do not have access to this company.');
      const where = { companyProfileId, ...(input.payrollPeriodId ? { payrollPeriodId: String(input.payrollPeriodId) } : {}), ...(input.employeeId ? { employeeId: String(input.employeeId) } : {}) };
      let notes = [];
      try {
        notes = await prisma.payrollReconciliationReviewerNote.findMany({ where, include: { events: { orderBy: { createdAt: 'asc' } }, createdBy: true, respondedBy: true, resolvedBy: true }, orderBy: { createdAt: 'desc' } });
      } catch (error) {
        // Reviewer notes are an optional workflow feature until its migration is deployed.
        // Do not expose a database-schema error in the reconciliation screen.
        if (error?.code !== 'P2021') throw error;
      }
      if (action === 'summary') {
        return res.status(200).json(await payrollReconciliationReadiness(companyProfileId, String(input.payrollPeriodId)));
      }
      return res.status(200).json(notes);
    }
    if (action === 'create') {
      if (!reviewer(user)) return fail(res, 403, 'Only a Super Admin can create reviewer notes.');
      const category = String(input.category || '').trim(); const reviewerNote = String(input.reviewerNote || '').trim();
      if (!category || !reviewerNote) return fail(res, 400, 'Category and reviewer note are required.');
      const reconciliation = await validateScope(input, user);
      const values = reconciliation?.manual_values || {}; const system = reconciliation?.system_values || {};
      const systemValue = Number(system[input.snapshotCategory || input.category]) || 0; const manualValue = Number(values[input.snapshotCategory || input.category]) || 0;
      const note = await prisma.$transaction(async tx => {
        const created = await tx.payrollReconciliationReviewerNote.create({ data: { companyProfileId: input.companyProfileId, payrollPeriodId: input.payrollPeriodId, employeeId: input.employeeId, reconciliationId: input.reconciliationId || null, category, reviewerNote, status: 'needs_response', createdByUserId: user.id } });
        await tx.payrollReconciliationReviewerNoteEvent.create({ data: { noteId: created.id, eventType: 'created', previousStatus: null, newStatus: 'needs_response', remarks: reviewerNote, ...actor(user), snapshotCategory: input.snapshotCategory || category, snapshotSystemValue: systemValue, snapshotManualValue: manualValue, snapshotDifferenceValue: systemValue - manualValue, snapshotValueType: input.snapshotValueType || 'currency' } });
        return created;
      });
      return res.status(201).json(note);
    }
    const note = await noteForUser(String(input.noteId || ''), user);
    if (action === 'history') return res.status(200).json(note.events);
    if (action === 'respond') {
      if (!responder(user) || !['needs_response', 'reopened'].includes(note.status)) return fail(res, 403, 'This reviewer note cannot be responded to.');
      const response = String(input.response || '').trim(); if (!response) return fail(res, 400, 'A response is required.');
      const eventType = note.status === 'reopened' ? 'resubmitted' : 'responded';
      const updated = await prisma.$transaction(async tx => { const next = await tx.payrollReconciliationReviewerNote.update({ where: { id: note.id }, data: { status: 'responded', response, respondedByUserId: user.id, respondedAt: new Date() } }); await tx.payrollReconciliationReviewerNoteEvent.create({ data: { noteId: note.id, eventType, previousStatus: note.status, newStatus: 'responded', remarks: response, ...actor(user) } }); return next; });
      return res.status(200).json(updated);
    }
    if (action === 'resolve' || action === 'reopen') {
      if (!reviewer(user)) return fail(res, 403, 'Only a Super Admin can review this note.');
      const allowed = action === 'resolve' ? ['responded'] : ['responded', 'resolved'];
      if (!allowed.includes(note.status)) return fail(res, 400, 'Invalid reviewer-note status transition.');
      const remarks = String(action === 'resolve' ? input.resolutionNote : input.reopenReason || '').trim(); if (!remarks) return fail(res, 400, 'A reviewer remark is required.');
      const nextStatus = action === 'resolve' ? 'resolved' : 'reopened';
      const updated = await prisma.$transaction(async tx => { const next = await tx.payrollReconciliationReviewerNote.update({ where: { id: note.id }, data: action === 'resolve' ? { status: nextStatus, resolutionNote: remarks, resolvedByUserId: user.id, resolvedAt: new Date() } : { status: nextStatus } }); await tx.payrollReconciliationReviewerNoteEvent.create({ data: { noteId: note.id, eventType: action === 'resolve' ? 'resolved' : 'reopened', previousStatus: note.status, newStatus: nextStatus, remarks, ...actor(user) } }); return next; });
      return res.status(200).json(updated);
    }
    return fail(res, 400, 'Unknown reviewer-note action.');
  } catch (error) { return fail(res, error.status || 500, error.message || 'Reviewer-note request failed.'); }
}
