// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import {
  createRecord,
  deleteRecord,
  listRecords,
  updateRecord,
} from "@/server/entityStore";

function sendError(res, error) {
  if (error.code === "P1000") {
    return res.status(503).json({
      error:
        "Database authentication failed. Update DATABASE_URL in .env with valid local PostgreSQL credentials, then restart the dev server.",
    });
  }

  res.status(error.statusCode || 500).json({
    error: error.message || "Unexpected server error",
  });
}

function entityNameFromQuery(query) {
  const raw = query.entity;
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

export default async function handler(req, res) {
  const entity = entityNameFromQuery(req.query);
  if (!entity) {
    return res.status(400).json({ error: "Entity name required" });
  }

  try {
    if (req.method === "GET") {
      const filter = req.query.filter ? JSON.parse(req.query.filter) : {};
      const records = await listRecords(entity, {
        filter,
        sort: req.query.sort,
        limit: req.query.limit,
      });
      return res.status(200).json(records);
    }

    if (req.method === "POST") {
      let data = req.body;
      if (entity === "CompanyProfile") {
        const session = await getServerSession(req, res, authOptions);
        data = {
          ...(req.body || {}),
          ...(session?.user?.id
            ? {
                created_by_user_id: req.body?.created_by_user_id || session.user.id,
                created_by_user_email: req.body?.created_by_user_email || session.user.email || null,
                created_by_user_name: req.body?.created_by_user_name || session.user.name || null,
              }
            : {}),
        };
      }
      const record = await createRecord(entity, data);
      return res.status(201).json(record);
    }

    if (req.method === "PATCH") {
      const record = await updateRecord(entity, req.body.id, req.body.data);
      return res.status(200).json(record);
    }

    if (req.method === "DELETE") {
      const result = await deleteRecord(entity, req.body.id);
      return res.status(200).json(result);
    }

    res.setHeader("Allow", "GET,POST,PATCH,DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return sendError(res, error);
  }
}
