// @ts-nocheck
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

export default async function handler(req, res) {
  const { entity } = req.query;

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
      const record = await createRecord(entity, req.body);
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
