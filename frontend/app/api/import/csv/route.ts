import { NextResponse, type NextRequest } from "next/server";
import { parse } from "csv-parse/sync";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/db/client";

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const iso = new Date(trimmed);
  if (!Number.isNaN(iso.getTime())) return iso;

  // Accept common EU format: DD/MM/YYYY
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    const d = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(d.getTime())) return d;
  }

  return null;
}

export async function POST(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET
  });
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const content = await file.text();
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as Array<Record<string, unknown>>;

  let upserted = 0;
  let skipped = 0;

  for (const row of records) {
    const experimentId = String(row.experimentId ?? "").trim();
    const testName = String(row.testName ?? "").trim();
    if (!experimentId || !testName) {
      skipped += 1;
      continue;
    }

    await prisma.experiment.upsert({
      where: { experimentId },
      create: {
        experimentId,
        testName,
        vertical: row.vertical ? String(row.vertical).trim() : null,
        geo: row.geo ? String(row.geo).trim() : null,
        dateLaunched: parseDate(row.dateLaunched),
        dateConcluded: parseDate(row.dateConcluded),
        winningVar: row.winningVar ? String(row.winningVar).trim() : null
      },
      update: {
        testName,
        vertical: row.vertical ? String(row.vertical).trim() : null,
        geo: row.geo ? String(row.geo).trim() : null,
        dateLaunched: parseDate(row.dateLaunched),
        dateConcluded: parseDate(row.dateConcluded),
        winningVar: row.winningVar ? String(row.winningVar).trim() : null
      }
    });
    upserted += 1;
  }

  return NextResponse.json({
    ok: true,
    fileName: file.name,
    rows: records.length,
    upserted,
    skipped
  });
}
