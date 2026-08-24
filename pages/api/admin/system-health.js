// @ts-nocheck
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { prisma } from "@/server/prisma";
import { Prisma } from "@prisma/client";

const WARNING = 70;
const CRITICAL = 85;
const level = value => value >= CRITICAL ? "critical" : value >= WARNING ? "warning" : "healthy";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: "Not authenticated" });
  if (session.user.role !== "super_admin") return res.status(403).json({ error: "Not authorized" });
  try {
    const [health, size, connections, maxConnections, tables] = await Promise.all([
      prisma.$queryRaw(Prisma.sql`SELECT 1 AS ok`),
      prisma.$queryRaw(Prisma.sql`SELECT pg_database_size(current_database())::bigint AS bytes`),
      prisma.$queryRaw(Prisma.sql`SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname = current_database()`),
      prisma.$queryRaw(Prisma.sql`SHOW max_connections`),
      prisma.$queryRaw(Prisma.sql`SELECT s.schemaname, s.relname, u.n_live_tup::bigint AS estimated_rows, pg_relation_size(s.relid)::bigint AS data_bytes, pg_indexes_size(s.relid)::bigint AS index_bytes, pg_total_relation_size(s.relid)::bigint AS total_bytes FROM pg_catalog.pg_statio_user_tables s JOIN pg_stat_user_tables u ON u.relid = s.relid ORDER BY pg_total_relation_size(s.relid) DESC LIMIT 10`),
    ]);
    const activeConnections = Number(connections[0]?.count || 0);
    const max = Number(maxConnections[0]?.max_connections || 0);
    const utilization = max ? activeConnections / max * 100 : 0;
    return res.status(200).json({ database: { status: health[0]?.ok === 1 ? level(utilization) : "unavailable", sizeBytes: Number(size[0]?.bytes || 0), activeConnections, maxConnections: max, connectionUtilizationPercent: Number(utilization.toFixed(1)), tables: tables.map(t => ({ name: `${t.schemaname}.${t.relname}`, estimatedRows: Number(t.estimated_rows || 0), dataBytes: Number(t.data_bytes || 0), indexBytes: Number(t.index_bytes || 0), totalBytes: Number(t.total_bytes || 0) })) }, application: { status: "online" }, checkedAt: new Date().toISOString() });
  } catch (error) {
    console.error("System health query failed", error);
    return res.status(503).json({ error: "System health is temporarily unavailable." });
  }
}
