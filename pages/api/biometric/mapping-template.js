// @ts-nocheck
import ExcelJS from "exceljs";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { listRecords } from "@/server/entityStore";
import { prisma } from "@/server/prisma";

function assignedCompanyIds(session) {
  return [
    ...(Array.isArray(session?.user?.company_profile_ids) ? session.user.company_profile_ids : []),
    ...String(session?.user?.company_profile_id || "").split(","),
  ].map(value => String(value || "").trim()).filter(Boolean);
}

function safeFilename(value) {
  return String(value || "company").trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "company";
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) return res.status(401).json({ error: "Authentication required." });
  if (!["super_admin", "admin", "hr_staff", "user"].includes(session.user.role)) {
    return res.status(403).json({ error: "Your role is not allowed to manage biometric mappings." });
  }

  const companyProfileId = String(req.query.company_profile_id || "").trim();
  if (!companyProfileId) return res.status(400).json({ error: "Company is required." });
  if (session.user.role !== "super_admin" && !assignedCompanyIds(session).includes(companyProfileId)) {
    return res.status(403).json({ error: "You are not assigned to this company." });
  }

  const [companies, employees, deviceCompanies] = await Promise.all([
    listRecords("CompanyProfile", { filter: { id: companyProfileId }, limit: 1 }),
    listRecords("Employee", { filter: { company_profile_id: companyProfileId }, sort: "last_name", limit: 10000 }),
    prisma.biometricDeviceCompany.findMany({
      where: { companyProfileId, status: "active", device: { status: "active" } },
      include: { device: true },
    }),
  ]);
  const company = companies[0];
  if (!company) return res.status(404).json({ error: "Company not found." });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PayrollPH";
  const mapping = workbook.addWorksheet("Biometric Mapping");
  const employeesSheet = workbook.addWorksheet("Employee Reference");
  const devicesSheet = workbook.addWorksheet("Device Reference");
  const instructions = workbook.addWorksheet("Instructions");

  mapping.columns = [
    { header: "employee_id", key: "employee_id", width: 24 },
    { header: "device_user_id", key: "device_user_id", width: 20 },
    { header: "device_serial", key: "device_serial", width: 24 },
  ];
  mapping.views = [{ state: "frozen", ySplit: 1 }];
  mapping.getRow(1).font = { bold: true };
  mapping.addRow({
    employee_id: employees.find(employee => String(employee.status || "active").toLowerCase() === "active")?.employee_id || "EMP001",
    device_user_id: "1",
    device_serial: deviceCompanies[0]?.device?.deviceSerial || "202605260025",
  });

  employeesSheet.columns = [
    { header: "employee_id", key: "employee_id", width: 24 },
    { header: "employee_name", key: "employee_name", width: 38 },
    { header: "department", key: "department", width: 24 },
    { header: "status", key: "status", width: 14 },
  ];
  employees.forEach(employee => employeesSheet.addRow({
    employee_id: employee.employee_id,
    employee_name: [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(" "),
    department: employee.department || "",
    status: employee.status || "active",
  }));
  employeesSheet.getRow(1).font = { bold: true };
  employeesSheet.views = [{ state: "frozen", ySplit: 1 }];

  devicesSheet.columns = [
    { header: "device_serial", key: "device_serial", width: 24 },
    { header: "terminal_type", key: "terminal_type", width: 18 },
    { header: "product_name", key: "product_name", width: 22 },
    { header: "site", key: "site", width: 28 },
  ];
  deviceCompanies.forEach(link => devicesSheet.addRow({
    device_serial: link.device.deviceSerial,
    terminal_type: link.device.terminalType || "",
    product_name: link.device.productName || "",
    site: link.device.siteName || link.device.siteCode || "",
  }));
  devicesSheet.getRow(1).font = { bold: true };

  instructions.columns = [{ width: 100 }];
  [
    `PayrollPH Biometric Employee Mapping — ${company.company_name || company.trade_name || companyProfileId}`,
    "1. Do not change the column names in the Biometric Mapping sheet.",
    "2. employee_id must already exist and be ACTIVE in the selected PayrollPH company.",
    "3. device_user_id is the User ID enrolled on the biometric terminal. It must be unique on that device.",
    "4. device_serial must be an active biometric device authorized for this company.",
    "5. Use the Employee Reference and Device Reference sheets to avoid typing mistakes.",
    "6. Upload the completed XLSX in PayrollPH. The system validates every row before saving anything.",
    "7. If any row has an error, correct it and upload again. No partial bulk save is performed.",
    "8. QR attendance remains available as fallback; biometric mapping does not disable QR punching.",
  ].forEach((value, index) => {
    const row = instructions.getRow(index + 1);
    row.getCell(1).value = value;
    row.getCell(1).alignment = { wrapText: true, vertical: "top" };
    if (index === 0) row.getCell(1).font = { bold: true, size: 14 };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${safeFilename(company.company_name || company.trade_name)}-biometric-mapping-template.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.status(200).send(Buffer.from(buffer));
}
