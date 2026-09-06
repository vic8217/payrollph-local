// @ts-nocheck
import ExcelJS from "exceljs";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { listRecords } from "@/server/entityStore";
import { prisma } from "@/server/prisma";

function assignedCompanyIds(session) {
  return [...(Array.isArray(session?.user?.company_profile_ids) ? session.user.company_profile_ids : []), ...String(session?.user?.company_profile_id || "").split(",")]
    .map(value => String(value || "").trim()).filter(Boolean);
}
function safeFilename(value) { return String(value || "company").trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "company"; }

export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed." }); }
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) return res.status(401).json({ error: "Authentication required." });
  if (!["super_admin", "admin", "hr_staff", "user"].includes(session.user.role)) return res.status(403).json({ error: "Your role is not allowed to manage biometric mappings." });
  const companyProfileId = String(req.query.company_profile_id || "").trim();
  if (!companyProfileId) return res.status(400).json({ error: "Company is required." });
  if (session.user.role !== "super_admin" && !assignedCompanyIds(session).includes(companyProfileId)) return res.status(403).json({ error: "You are not assigned to this company." });

  const [companies, employees, deviceCompanies] = await Promise.all([
    listRecords("CompanyProfile", { filter: { id: companyProfileId }, limit: 1 }),
    listRecords("Employee", { filter: { company_profile_id: companyProfileId }, sort: "last_name", limit: 10000 }),
    prisma.biometricDeviceCompany.findMany({ where: { companyProfileId, status: "active", device: { status: "active" } }, include: { device: true } }),
  ]);
  const company = companies[0];
  if (!company) return res.status(404).json({ error: "Company not found." });
  const activeEmployees = employees.filter(employee => String(employee.status || "active").toLowerCase() === "active");
  const defaultDevice = deviceCompanies[0]?.device;

  const workbook = new ExcelJS.Workbook(); workbook.creator = "PayrollPH";
  const mapping = workbook.addWorksheet("Biometric Mapping");
  const sample = workbook.addWorksheet("Sample Guide");
  const employeesSheet = workbook.addWorksheet("Employee Reference");
  const devicesSheet = workbook.addWorksheet("Device Reference");
  const instructions = workbook.addWorksheet("Instructions");

  const mappingColumns = [
    { header: "employee_id", key: "employee_id", width: 24 },
    { header: "device_user_id", key: "device_user_id", width: 20 },
    { header: "device_serial", key: "device_serial", width: 24 },
  ];
  mapping.columns = mappingColumns; mapping.views = [{ state: "frozen", ySplit: 1 }]; mapping.getRow(1).font = { bold: true };
  // Keep the actual import sheet clean. Users copy only their real mapping data here.

  sample.columns = [
    ...mappingColumns,
    { header: "guide_only_do_not_upload", key: "guide", width: 52 },
  ];
  sample.getRow(1).font = { bold: true }; sample.views = [{ state: "frozen", ySplit: 1 }];
  const sampleEmployees = activeEmployees.slice(0, 3);
  for (let index = 0; index < Math.max(3, sampleEmployees.length); index += 1) {
    const employee = sampleEmployees[index];
    sample.addRow({
      employee_id: employee?.employee_id || `EMP-${String(index + 1).padStart(3, "0")}`,
      device_user_id: String(index + 1),
      device_serial: defaultDevice?.deviceSerial || "202605260025",
      guide: index === 0 ? "Example only. Copy the format to the Biometric Mapping sheet using the employee's actual device User ID." : "Example only.",
    });
  }

  employeesSheet.columns = [
    { header: "employee_id", key: "employee_id", width: 24 }, { header: "employee_name", key: "employee_name", width: 38 },
    { header: "department", key: "department", width: 24 }, { header: "status", key: "status", width: 14 },
  ];
  employees.forEach(employee => employeesSheet.addRow({ employee_id: employee.employee_id, employee_name: [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(" "), department: employee.department || "", status: employee.status || "active" }));
  employeesSheet.getRow(1).font = { bold: true }; employeesSheet.views = [{ state: "frozen", ySplit: 1 }];

  devicesSheet.columns = [
    { header: "device_serial", key: "device_serial", width: 24 }, { header: "terminal_type", key: "terminal_type", width: 18 },
    { header: "product_name", key: "product_name", width: 22 }, { header: "site", key: "site", width: 28 },
  ];
  deviceCompanies.forEach(link => devicesSheet.addRow({ device_serial: link.device.deviceSerial, terminal_type: link.device.terminalType || "", product_name: link.device.productName || "", site: link.device.siteName || link.device.siteCode || "" }));
  devicesSheet.getRow(1).font = { bold: true };

  instructions.columns = [{ width: 110 }];
  [
    `PayrollPH Biometric Employee Mapping — ${company.company_name || company.trade_name || companyProfileId}`,
    "STEP 1 — Open the Sample Guide sheet to see exactly how a completed row should look.",
    "STEP 2 — Open Employee Reference and find each employee's PayrollPH employee_id.",
    "STEP 3 — Open Device Reference and use the correct device_serial.",
    "STEP 4 — In Biometric Mapping, enter employee_id + the User ID enrolled on that biometric terminal + device_serial.",
    "STEP 5 — Save this workbook as XLSX and upload it in Settings → Biometric Mapping.",
    "IMPORTANT — Do not rename the Biometric Mapping sheet or its three column headers.",
    "IMPORTANT — device_user_id is the number enrolled on the physical terminal; do not invent a new number in this spreadsheet.",
    "IMPORTANT — Each device User ID must identify only one employee on the same device.",
    "VALIDATION — PayrollPH checks the whole file before saving. If any row fails, no rows from that upload are saved.",
    "FALLBACK — QR attendance remains available; biometric mapping does not disable QR attendance.",
  ].forEach((value, index) => { const row = instructions.getRow(index + 1); row.getCell(1).value = value; row.getCell(1).alignment = { wrapText: true, vertical: "top" }; if (index === 0) row.getCell(1).font = { bold: true, size: 14 }; });

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${safeFilename(company.company_name || company.trade_name)}-biometric-mapping-template.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.status(200).send(Buffer.from(buffer));
}
