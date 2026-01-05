import { prisma } from "@/lib/db/client";
import {
  fetchSheetValues,
  fetchSpreadsheetMetadata,
  quoteSheetTitleForA1
} from "@/lib/google/sheets";
import { extractDriveFileId, fetchDriveFileMetadata } from "@/lib/google/drive";
import { exportGoogleSheetToCsv } from "@/lib/google/drive";
import { parse } from "csv-parse/sync";

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const iso = new Date(trimmed);
  if (!Number.isNaN(iso.getTime())) return iso;

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

function parseNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed
    .replaceAll(",", "")
    .replace(/[^\d.+-]/g, "");
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function normalizeHeaderKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function getFromRow(row: string[], headerIndex: Map<string, number>, key: string) {
  const idx = headerIndex.get(key);
  if (idx === undefined) return "";
  return String(row[idx] ?? "").trim();
}

function getFromRowAny(row: string[], headerIndex: Map<string, number>, keys: string[]) {
  for (const key of keys) {
    const value = getFromRow(row, headerIndex, key);
    if (value) return value;
  }
  return "";
}

type ImportResult = {
  ok: true;
  source: "sheets_values" | "drive_export_csv";
  spreadsheetId: string;
  range: string;
  limit: number;
  upserted: number;
  skipped: number;
  skippedExisting: number;
  alreadyUpToDate: boolean;
  totalRows: number;
  driveLookups: number;
};

async function upsertFromTabular(options: {
  accessToken: string;
  spreadsheetId: string;
  range: string;
  limit?: number;
  values: string[][];
  source: ImportResult["source"];
  existingExperimentIds?: Set<string>;
}) {
  const { accessToken, spreadsheetId, range, limit, values, source, existingExperimentIds } =
    options;
  const effectiveLimit = limit ?? Math.max(0, values.length - 1);

  const rawHeader = (values[0] ?? []).map((h) => String(h).trim());
  const normalizedHeader = rawHeader.map(normalizeHeaderKey);
  const headerIndex = new Map(normalizedHeader.map((h, idx) => [h, idx]));

  let upserted = 0;
  let skipped = 0;
  let driveLookups = 0;
  let skippedExisting = 0;
  const existingIds = existingExperimentIds ?? new Set<string>();

  for (const row of values.slice(1, 1 + effectiveLimit)) {
    const experimentId = getFromRowAny(row, headerIndex, [
      "experimentid",
      "experiment",
      "expid"
    ]);
    const testName = getFromRowAny(row, headerIndex, ["testname", "test", "name"]);

    if (!experimentId || !testName) {
      skipped += 1;
      continue;
    }

    if (existingIds.has(experimentId)) {
      skippedExisting += 1;
      continue;
    }

    const vertical = getFromRowAny(row, headerIndex, ["vertical"]);
    const geo = getFromRowAny(row, headerIndex, ["geo", "geography", "country"]);
    const dateLaunched = getFromRowAny(row, headerIndex, ["datelaunched", "launched"]);
    const dateConcluded = getFromRowAny(row, headerIndex, ["dateconcluded", "concluded"]);
    const winningVar = getFromRowAny(row, headerIndex, ["winningvar", "winner"]);
    const launchedBy = getFromRowAny(row, headerIndex, ["launchedby"]);
    const userJourneyType = getFromRowAny(row, headerIndex, ["userjourneytype"]);
    const targetMetric = getFromRowAny(row, headerIndex, ["targetmetric"]);
    const brand = getFromRowAny(row, headerIndex, ["brand"]);
    const monetisationMethod = getFromRowAny(row, headerIndex, ["monetisationmethod", "monetizationmethod"]);
    const promotedRaw = getFromRowAny(row, headerIndex, ["hasitbeenpromoted", "promoted"]);
    const promoted =
      promotedRaw && /^(yes|y|true|1)$/i.test(promotedRaw.trim()) ? true : promotedRaw ? false : null;
    const variationsCount = getFromRowAny(row, headerIndex, ["ofvariations"]);
    const baseUrl = getFromRowAny(row, headerIndex, ["baseurl", "url"]);
    const audience = getFromRowAny(row, headerIndex, ["audience"]);
    const mobileTrafficPct = getFromRowAny(row, headerIndex, ["mobiletraffic"]);
    const visitsControl = getFromRowAny(row, headerIndex, ["visitscontrol"]);
    const visitsVar1 = getFromRowAny(row, headerIndex, ["visitsvariation1"]);
    const visitsVar2 = getFromRowAny(row, headerIndex, ["visitsvariation2"]);
    const visitsVar3 = getFromRowAny(row, headerIndex, ["visitsvariation3"]);
    const totalVisits = getFromRowAny(row, headerIndex, ["totalvisits"]);
    const primaryMetricName = getFromRowAny(row, headerIndex, ["primarymetricname"]);
    const primaryControlConv = getFromRowAny(row, headerIndex, ["primarymetriccontrolconversions"]);
    const primaryVar1Conv = getFromRowAny(row, headerIndex, ["primarymetricvariation1conversions"]);
    const primaryVar2Conv = getFromRowAny(row, headerIndex, ["primarymetricvariation2conversions"]);
    const primaryVar3Conv = getFromRowAny(row, headerIndex, ["primarymetricvariation3conversions"]);
    const primarySignificance1 = getFromRowAny(row, headerIndex, ["primarymetricsignificance1"]);
    const secondaryMetricName = getFromRowAny(row, headerIndex, ["secondarymetricname"]);
    const secondaryControlConv = getFromRowAny(row, headerIndex, ["secondarymetriccontrolconversions"]);
    const secondaryVar1Conv = getFromRowAny(row, headerIndex, ["secondarymetricvariation1conversions"]);
    const secondaryVar2Conv = getFromRowAny(row, headerIndex, ["secondarymetricvariation2conversions"]);
    const secondaryVar3Conv = getFromRowAny(row, headerIndex, ["secondarymetricvariation3conversions"]);
    const tertiaryMetricName = getFromRowAny(row, headerIndex, ["tertiarymetricname"]);
    const tertiaryControlConv = getFromRowAny(row, headerIndex, ["tertiarymetriccontrolconversions"]);
    const tertiaryVar1Conv = getFromRowAny(row, headerIndex, ["tertiarymetricvariation1conversions"]);
    const tertiaryVar2Conv = getFromRowAny(row, headerIndex, ["tertiarymetricvariation2conversions"]);
    const tertiaryVar3Conv = getFromRowAny(row, headerIndex, ["tertiarymetricvariation3conversions"]);
    const tradingHub = getFromRowAny(row, headerIndex, ["tradinghub"]);
    const masterLever = getFromRowAny(row, headerIndex, ["masterlever"]);
    const lever = getFromRowAny(row, headerIndex, ["lever"]);
    const crChangeV1 = getFromRowAny(row, headerIndex, ["crchangev1"]);
    const crChangeV2 = getFromRowAny(row, headerIndex, ["crchangev2"]);
    const crChangeV3 = getFromRowAny(row, headerIndex, ["crchangev3"]);
    const rpvChangeV1 = getFromRowAny(row, headerIndex, ["rpvchangev1"]);
    const rpvChangeV2 = getFromRowAny(row, headerIndex, ["rpvchangev2"]);
    const rpvChangeV3 = getFromRowAny(row, headerIndex, ["rpvchangev3"]);
    const elementChanged = getFromRowAny(row, headerIndex, ["elementchanged"]);
    const changeType = getFromRowAny(row, headerIndex, ["changetype"]);
    const observedRevenueImpact = getFromRowAny(row, headerIndex, ["observedrevenueimpact"]);
    const optimizelyLink = getFromRowAny(row, headerIndex, ["optimizelylink"]);
    const hypothesis = getFromRowAny(row, headerIndex, ["hypothesis"]);
    const lessonLearned = getFromRowAny(row, headerIndex, ["lessonlearned", "lessonslearned", "lesson", "lessons"]);
    const monthlyExtrapRaw = getFromRowAny(row, headerIndex, ["monthlyextrap", "monthlyextrapolation"]);
    const monthlyExtrap = monthlyExtrapRaw ? parseNumber(monthlyExtrapRaw) : null;

    const screenshotRaw = getFromRowAny(row, headerIndex, [
      "screenshotdrivefileid",
      "drivefileid",
      "screenshot",
      "screenshoturl"
    ]);
    const screenshotDriveFileId = screenshotRaw ? extractDriveFileId(screenshotRaw) : null;

    let screenshotWebUrl: string | null = null;
    let screenshotThumbnailUrl: string | null = null;
    if (screenshotDriveFileId) {
      try {
        driveLookups += 1;
        const file = await fetchDriveFileMetadata({
          accessToken,
          fileId: screenshotDriveFileId
        });
        screenshotWebUrl = file.webViewLink ?? null;
        screenshotThumbnailUrl = file.thumbnailLink ?? null;
      } catch {
        // Keep import resilient: screenshot metadata is optional.
      }
    }

    await prisma.experiment.upsert({
      where: { experimentId },
      create: {
        experimentId,
        testName,
        vertical: vertical || null,
        geo: geo || null,
        dateLaunched: parseDate(dateLaunched),
        dateConcluded: parseDate(dateConcluded),
        winningVar: winningVar || null,
        launchedBy: launchedBy || null,
        userJourneyType: userJourneyType || null,
        targetMetric: targetMetric || null,
        brand: brand || null,
        monetisationMethod: monetisationMethod || null,
        promoted,
        variationsCount: variationsCount ? parseNumber(variationsCount) : null,
        baseUrl: baseUrl || null,
        audience: audience || null,
        mobileTrafficPct: mobileTrafficPct ? parseNumber(mobileTrafficPct) : null,
        visitsControl: visitsControl ? parseNumber(visitsControl) : null,
        visitsVar1: visitsVar1 ? parseNumber(visitsVar1) : null,
        visitsVar2: visitsVar2 ? parseNumber(visitsVar2) : null,
        visitsVar3: visitsVar3 ? parseNumber(visitsVar3) : null,
        totalVisits: totalVisits ? parseNumber(totalVisits) : null,
        primaryMetricName: primaryMetricName || null,
        primaryControlConv: primaryControlConv ? parseNumber(primaryControlConv) : null,
        primaryVar1Conv: primaryVar1Conv ? parseNumber(primaryVar1Conv) : null,
        primaryVar2Conv: primaryVar2Conv ? parseNumber(primaryVar2Conv) : null,
        primaryVar3Conv: primaryVar3Conv ? parseNumber(primaryVar3Conv) : null,
        primarySignificance1: primarySignificance1 ? parseNumber(primarySignificance1) : null,
        secondaryMetricName: secondaryMetricName || null,
        secondaryControlConv: secondaryControlConv ? parseNumber(secondaryControlConv) : null,
        secondaryVar1Conv: secondaryVar1Conv ? parseNumber(secondaryVar1Conv) : null,
        secondaryVar2Conv: secondaryVar2Conv ? parseNumber(secondaryVar2Conv) : null,
        secondaryVar3Conv: secondaryVar3Conv ? parseNumber(secondaryVar3Conv) : null,
        tertiaryMetricName: tertiaryMetricName || null,
        tertiaryControlConv: tertiaryControlConv ? parseNumber(tertiaryControlConv) : null,
        tertiaryVar1Conv: tertiaryVar1Conv ? parseNumber(tertiaryVar1Conv) : null,
        tertiaryVar2Conv: tertiaryVar2Conv ? parseNumber(tertiaryVar2Conv) : null,
        tertiaryVar3Conv: tertiaryVar3Conv ? parseNumber(tertiaryVar3Conv) : null,
        tradingHub: tradingHub || null,
        masterLever: masterLever || null,
        lever: lever || null,
        crChangeV1: crChangeV1 ? parseNumber(crChangeV1) : null,
        crChangeV2: crChangeV2 ? parseNumber(crChangeV2) : null,
        crChangeV3: crChangeV3 ? parseNumber(crChangeV3) : null,
        rpvChangeV1: rpvChangeV1 ? parseNumber(rpvChangeV1) : null,
        rpvChangeV2: rpvChangeV2 ? parseNumber(rpvChangeV2) : null,
        rpvChangeV3: rpvChangeV3 ? parseNumber(rpvChangeV3) : null,
        elementChanged: elementChanged || null,
        changeType: changeType || null,
        observedRevenueImpact: observedRevenueImpact ? parseNumber(observedRevenueImpact) : null,
        optimizelyLink: optimizelyLink || null,
        hypothesis: hypothesis || null,
        lessonLearned: lessonLearned || null,
        monthlyExtrap,
        screenshotDriveFileId,
        screenshotWebUrl,
        screenshotThumbnailUrl
      },
      update: {
        testName,
        vertical: vertical || null,
        geo: geo || null,
        dateLaunched: parseDate(dateLaunched),
        dateConcluded: parseDate(dateConcluded),
        winningVar: winningVar || null,
        launchedBy: launchedBy || null,
        userJourneyType: userJourneyType || null,
        targetMetric: targetMetric || null,
        brand: brand || null,
        monetisationMethod: monetisationMethod || null,
        promoted,
        variationsCount: variationsCount ? parseNumber(variationsCount) : null,
        baseUrl: baseUrl || null,
        audience: audience || null,
        mobileTrafficPct: mobileTrafficPct ? parseNumber(mobileTrafficPct) : null,
        visitsControl: visitsControl ? parseNumber(visitsControl) : null,
        visitsVar1: visitsVar1 ? parseNumber(visitsVar1) : null,
        visitsVar2: visitsVar2 ? parseNumber(visitsVar2) : null,
        visitsVar3: visitsVar3 ? parseNumber(visitsVar3) : null,
        totalVisits: totalVisits ? parseNumber(totalVisits) : null,
        primaryMetricName: primaryMetricName || null,
        primaryControlConv: primaryControlConv ? parseNumber(primaryControlConv) : null,
        primaryVar1Conv: primaryVar1Conv ? parseNumber(primaryVar1Conv) : null,
        primaryVar2Conv: primaryVar2Conv ? parseNumber(primaryVar2Conv) : null,
        primaryVar3Conv: primaryVar3Conv ? parseNumber(primaryVar3Conv) : null,
        primarySignificance1: primarySignificance1 ? parseNumber(primarySignificance1) : null,
        secondaryMetricName: secondaryMetricName || null,
        secondaryControlConv: secondaryControlConv ? parseNumber(secondaryControlConv) : null,
        secondaryVar1Conv: secondaryVar1Conv ? parseNumber(secondaryVar1Conv) : null,
        secondaryVar2Conv: secondaryVar2Conv ? parseNumber(secondaryVar2Conv) : null,
        secondaryVar3Conv: secondaryVar3Conv ? parseNumber(secondaryVar3Conv) : null,
        tertiaryMetricName: tertiaryMetricName || null,
        tertiaryControlConv: tertiaryControlConv ? parseNumber(tertiaryControlConv) : null,
        tertiaryVar1Conv: tertiaryVar1Conv ? parseNumber(tertiaryVar1Conv) : null,
        tertiaryVar2Conv: tertiaryVar2Conv ? parseNumber(tertiaryVar2Conv) : null,
        tertiaryVar3Conv: tertiaryVar3Conv ? parseNumber(tertiaryVar3Conv) : null,
        tradingHub: tradingHub || null,
        masterLever: masterLever || null,
        lever: lever || null,
        crChangeV1: crChangeV1 ? parseNumber(crChangeV1) : null,
        crChangeV2: crChangeV2 ? parseNumber(crChangeV2) : null,
        crChangeV3: crChangeV3 ? parseNumber(crChangeV3) : null,
        rpvChangeV1: rpvChangeV1 ? parseNumber(rpvChangeV1) : null,
        rpvChangeV2: rpvChangeV2 ? parseNumber(rpvChangeV2) : null,
        rpvChangeV3: rpvChangeV3 ? parseNumber(rpvChangeV3) : null,
        elementChanged: elementChanged || null,
        changeType: changeType || null,
        observedRevenueImpact: observedRevenueImpact ? parseNumber(observedRevenueImpact) : null,
        optimizelyLink: optimizelyLink || null,
        hypothesis: hypothesis || null,
        lessonLearned: lessonLearned || null,
        monthlyExtrap,
        screenshotDriveFileId,
        screenshotWebUrl,
        screenshotThumbnailUrl
      }
    });

    upserted += 1;
  }

  return {
    ok: true as const,
    source,
    spreadsheetId,
    range,
    limit: effectiveLimit,
    upserted,
    skipped,
    totalRows: Math.max(0, values.length - 1),
    driveLookups,
    skippedExisting,
    alreadyUpToDate: false
  };
}

export async function importExperimentsFromSheet(options: {
  accessToken: string;
  spreadsheetId: string;
  rangeA1: string;
  gid?: number;
  limit?: number;
}) {
  const { accessToken, spreadsheetId, rangeA1, gid, limit } = options;

  let effectiveRangeA1 = rangeA1;
  if (gid && !effectiveRangeA1.includes("!")) {
    const meta = await fetchSpreadsheetMetadata({ accessToken, spreadsheetId });
    const sheetTitle =
      meta.sheets?.find((s) => s.properties?.sheetId === gid)?.properties?.title ?? null;
    if (sheetTitle) {
      effectiveRangeA1 = `${quoteSheetTitleForA1(sheetTitle)}!${effectiveRangeA1}`;
    }
  }

  // 1) Try Sheets Values API (works well for structured tabular data and specific ranges).
  try {
    const data = await fetchSheetValues({
      accessToken,
      spreadsheetId,
      rangeA1: effectiveRangeA1
    });
    const values = data.values ?? [];
    if (values.length >= 2) {
      const header = values[0] ?? [];
      const headerIdx = new Map(
        header.map((h, idx) => [normalizeHeaderKey(String(h)), idx])
      );
      const uniqueIds = new Set(
        values
          .slice(1, limit ? limit + 1 : undefined)
          .map((row) =>
            getFromRowAny(row, headerIdx, ["experimentid", "experiment", "expid"])
          )
          .filter(Boolean)
      );
      const existingRows = uniqueIds.size
        ? await prisma.experiment.findMany({
            where: { experimentId: { in: Array.from(uniqueIds) } },
            select: { experimentId: true }
          })
        : [];
      const existingIds = new Set(existingRows.map((r) => r.experimentId));
      if (existingIds.size === uniqueIds.size && uniqueIds.size > 0) {
        return {
          ok: true as const,
          source: "sheets_values" as const,
          spreadsheetId,
          range: data.range,
          limit: limit ?? Math.max(0, values.length - 1),
          upserted: 0,
          skipped: 0,
          skippedExisting: existingIds.size,
          alreadyUpToDate: true,
          totalRows: Math.max(0, values.length - 1),
          driveLookups: 0
        };
      }

      const result = await upsertFromTabular({
        accessToken,
        spreadsheetId,
        range: data.range,
        limit,
        values,
        source: "sheets_values",
        existingExperimentIds: existingIds
      });
      if (result.upserted > 0 || result.skippedExisting > 0) return result;
    }
  } catch {
    // Fall through to Drive CSV export.
  }

  // 2) Fallback: export the spreadsheet as CSV via Drive API.
  // This can be more forgiving when headers are not in the expected format.
  const csvText = await exportGoogleSheetToCsv({ accessToken, spreadsheetId });
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as Array<Record<string, unknown>>;

  const header = records.length ? Object.keys(records[0] ?? {}) : [];
  const rows: string[][] = [
    header,
    ...records.map((r) => header.map((h) => String(r[h] ?? "")))
  ];

  const uniqueIds = new Set(
    records
      .slice(0, limit ? limit : undefined)
      .map((r) => String(r["Experiment ID"] ?? r["experimentId"] ?? "").trim())
      .filter(Boolean)
  );
  const existingRows = uniqueIds.size
    ? await prisma.experiment.findMany({
        where: { experimentId: { in: Array.from(uniqueIds) } },
        select: { experimentId: true }
      })
    : [];
  const existingIds = new Set(existingRows.map((r) => r.experimentId));
  if (existingIds.size === uniqueIds.size && uniqueIds.size > 0) {
    return {
      ok: true as const,
      source: "drive_export_csv" as const,
      spreadsheetId,
      range: "drive_export_csv",
      limit: limit ?? Math.max(0, rows.length - 1),
      upserted: 0,
      skipped: 0,
      skippedExisting: existingIds.size,
      alreadyUpToDate: true,
      totalRows: Math.max(0, rows.length - 1),
      driveLookups: 0
    };
  }

  return await upsertFromTabular({
    accessToken,
    spreadsheetId,
    range: "drive_export_csv",
    limit,
    values: rows,
    source: "drive_export_csv",
    existingExperimentIds: existingIds
  });
}
