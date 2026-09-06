// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/server/prisma";
import { reprocessEventIds } from "@/server/biometric/reprocess";
import { listRecords } from "@/server/entityStore";
import {
  dismissInterpretationReview,
  interpretTimeLogs,
  requeueFailedInterpretation,
  rollbackInterpretation,
} from "@/server/biometric/interpretTimeLog";
import { previewInterpretation } from "@/server/biometric/previewInterpretation";
import { handleBiometricEventsRequest, jsonResponse } from "@/server/biometric/eventsApi";

const VIEW_ROLES = new Set(["super_admin", "admin", "hr_staff", "user"]);

function assignedCompanyIds(session) {
  return [
    ...(Array.isArray(session?.user?.company_profile_ids) ? session.user.company_profile_ids : []),
    ...String(session?.user?.company_profile_id || "").split(","),
  ].map(value => String(value || "").trim()).filter(Boolean);
}

async function authorize(req, res, companyProfileId) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    jsonResponse(res, 401, { error: "Authentication required." });
    return null;
  }
  if (!VIEW_ROLES.has(session.user.role)) {
    jsonResponse(res, 403, { error: "Your role is not allowed to view biometric events." });
    return null;
  }
  if (session.user.role !== "super_admin" && !assignedCompanyIds(session).includes(String(companyProfileId))) {
    jsonResponse(res, 403, { error: "You are not assigned to this company." });
    return null;
  }
  return session;
}

export default async function handler(req, res) {
  return handleBiometricEventsRequest(req, res, {
    authorize,
    prisma,
    interpretTimeLogs,
    rollbackInterpretation,
    dismissInterpretationReview,
    reprocessEventIds,
    requeueFailedInterpretation,
    listRecords,
    previewInterpretation,
  });
}
