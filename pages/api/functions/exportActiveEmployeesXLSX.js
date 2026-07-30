// @ts-nocheck
import ExcelJS from "exceljs";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { listRecords } from "@/server/entityStore";

const BORDER = {
  top: { style: "thin", color: { argb: "FF000000" } },
  left: { style: "thin", color: { argb: "FF000000" } },
  bottom: { style: "thin", color: { argb: "FF000000" } },
  right: { style: "thin", color: { argb: "FF000000" } },
};

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function formatBirthDate(value) {
  if (!value) return "";
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : String(value).trim();
}

function formatMobile(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("63")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

function safeFilename(value) {
  return String(value || "company")
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "company";
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const companyProfileId = String(req.query.company_profile_id || "").trim();
  if (!companyProfileId) {
    return res.status(400).json({ error: "Company is required" });
  }

  const [companies, employees] = await Promise.all([
    listRecords("CompanyProfile", { filter: { id: companyProfileId }, limit: 1 }),
    listRecords("Employee", {
      filter: { company_profile_id: companyProfileId, status: "active" },
      sort: "last_name",
      limit: 5000,
    }),
  ]);
  const company = companies[0];
  if (!company) {
    return res.status(404).json({ error: "Company not found" });
  }

  const companyName = String(company.company_name || company.trade_name || "the company").trim();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PayrollPH";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Active Employees", {
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0, footer: 0 },
    },
    properties: { defaultRowHeight: 14.25 },
  });

  sheet.columns = [
    { key: "spacer", width: 2.5, hidden: true },
    { key: "first", width: 27.14 },
    { key: "middle", width: 21.86 },
    { key: "last", width: 23.14 },
    { key: "birthDate", width: 23.86 },
    { key: "mobile", width: 16.86 },
  ];
  sheet.mergeCells("B1:F1");
  sheet.mergeCells("B2:F3");
  sheet.getRow(1).height = 42;
  sheet.getRow(2).height = 22.5;
  sheet.getRow(3).height = 25.5;
  sheet.getRow(4).height = 35;

  const title = sheet.getCell("B1");
  title.value = "CERTIFICATION";
  title.font = { name: "Arial", size: 14, bold: true };
  title.alignment = { horizontal: "center", vertical: "middle" };
  title.border = BORDER;

  const certification = sheet.getCell("B2");
  certification.value =
    `This is to certify that the names listed below are all employees of  ${companyName.toUpperCase()}  whom I have conducted online interview via video call or  face-to-face contact and due diligence following the   ${companyName.toUpperCase()}’s employee hiring process and in accordance with the Payroll Service Agreement with RCBC.`;
  certification.font = { name: "Arial", size: 10 };
  certification.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  certification.border = BORDER;

  const headers = [
    "FIRST NAME",
    "MIDDLE NAME",
    "LAST NAME",
    "DATE OF BIRTH \n(mm/dd/yyyy)",
    "MOBILE NUMBER\n( Format: 9171111111)",
  ];
  headers.forEach((value, index) => {
    const cell = sheet.getCell(4, index + 2);
    cell.value = value;
    cell.font = { name: "Arial", size: 9, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = BORDER;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
  });

  employees.forEach((employee, index) => {
    const row = sheet.getRow(index + 5);
    row.height = 14.25;
    row.values = [
      "",
      upper(employee.first_name),
      upper(employee.middle_name),
      upper(employee.last_name),
      formatBirthDate(employee.date_of_birth || employee.birth_date || employee.date_birth),
      formatMobile(employee.phone || employee.mobile_number || employee.mobile),
    ];
    for (let column = 2; column <= 6; column += 1) {
      const cell = row.getCell(column);
      cell.font = { name: "Arial", size: 9 };
      cell.alignment = { horizontal: column >= 5 ? "center" : "left", vertical: "middle" };
      cell.border = BORDER;
      cell.numFmt = "@";
    }
  });

  const nothingFollowsRowNumber = employees.length + 5;
  const certifiedByRowNumber = employees.length + 6;
  const nothingFollowsRow = sheet.getRow(nothingFollowsRowNumber);
  const certifiedByRow = sheet.getRow(certifiedByRowNumber);

  nothingFollowsRow.getCell(2).value = "******Nothing Follows******";
  certifiedByRow.getCell(2).value = "Certified by:";
  certifiedByRow.getCell(3).value = "Katherine Mae Dullin";

  [nothingFollowsRow, certifiedByRow].forEach((row) => {
    row.height = 14.25;
    for (let column = 2; column <= 6; column += 1) {
      const cell = row.getCell(column);
      cell.font = { name: "Arial", size: 9 };
      cell.alignment = { horizontal: "left", vertical: "middle" };
      cell.border = BORDER;
      cell.numFmt = "@";
    }
  });
  nothingFollowsRow.getCell(2).font = { name: "Arial", size: 9, bold: true };
  certifiedByRow.getCell(2).font = { name: "Arial", size: 9, bold: true };

  sheet.autoFilter = `B4:F${Math.max(4, employees.length + 4)}`;
  sheet.views = [{ state: "frozen", ySplit: 4, activeCell: "B5" }];
  sheet.printArea = `B1:F${certifiedByRowNumber}`;
  sheet.headerFooter.oddHeader = "";
  sheet.headerFooter.oddFooter = "";

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${safeFilename(companyName)}-active-employees.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", buffer.length);
  return res.status(200).send(Buffer.from(buffer));
}
