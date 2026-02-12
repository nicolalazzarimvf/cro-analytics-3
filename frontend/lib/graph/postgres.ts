/**
 * Graph data generation from Postgres.
 *
 * Replaces Neo4j: all relationship/similarity data is computed directly from
 * the Experiment table using SQL queries. The output is a simple {nodes, links}
 * structure consumed by the 3D graph visualisation.
 */

import { prisma } from "../db/client";

export type GraphNode = {
  id: string;
  label: string;
  type: string;
  count: number;
  primary?: boolean;
  href?: string;
  previewUrl?: string;
  title?: string;
};

export type GraphLink = {
  source: string;
  target: string;
  value: number;
};

export type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

type ExperimentMeta = {
  id: string;
  experimentId: string;
  testName: string | null;
  screenshotThumbnailUrl: string | null;
  screenshotWebUrl: string | null;
};

/**
 * Build graph data for a single experiment showing its attributes and similar experiments.
 * This replaces the Neo4j neighborhood query.
 */
export async function buildExperimentGraph(
  experimentId: string,
  context: "stats" | "experiment" = "stats",
  maxSimilar = 6
): Promise<GraphData> {
  // 1. Fetch the focal experiment
  const exp = await prisma.experiment.findFirst({
    where: { experimentId },
    select: {
      id: true,
      experimentId: true,
      testName: true,
      vertical: true,
      geo: true,
      brand: true,
      targetMetric: true,
      changeType: true,
      elementChanged: true,
      monthlyExtrap: true,
      screenshotThumbnailUrl: true,
      screenshotWebUrl: true,
    },
  });

  if (!exp) return { nodes: [], links: [] };

  const nodesMap = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  const backParam = context === "stats" ? "stats" : "experiments";
  const expId = exp.experimentId.trim();

  // 2. Add focal experiment node
  nodesMap.set(expId, {
    id: expId,
    label: expId,
    type: "experiment",
    count: 3,
    primary: true,
    href: `/experiments/${exp.id}?from=${backParam}`,
    title: exp.testName ?? undefined,
  });

  // 3. Add attribute nodes and links
  const addAttrNode = (value: string | null | undefined, type: string) => {
    const v = (value ?? "").trim();
    if (!v) return;
    if (!nodesMap.has(v)) {
      nodesMap.set(v, { id: v, label: v, type, count: 1 });
    }
    links.push({ source: expId, target: v, value: 2 });
  };

  addAttrNode(exp.changeType, "change");
  addAttrNode(exp.elementChanged, "element");
  addAttrNode(exp.vertical, "vertical");
  addAttrNode(exp.geo, "geo");
  addAttrNode(exp.brand, "brand");
  addAttrNode(exp.targetMetric, "metric");

  // 4. Find similar experiments by shared attributes (scored by overlap)
  const conditions: string[] = [];
  const params: any[] = [exp.experimentId]; // $1 = exclude self

  let paramIdx = 2;
  if (exp.changeType?.trim()) {
    conditions.push(`"changeType" = $${paramIdx}`);
    params.push(exp.changeType.trim());
    paramIdx++;
  }
  if (exp.elementChanged?.trim()) {
    conditions.push(`"elementChanged" = $${paramIdx}`);
    params.push(exp.elementChanged.trim());
    paramIdx++;
  }
  if (exp.vertical?.trim()) {
    conditions.push(`"vertical" = $${paramIdx}`);
    params.push(exp.vertical.trim());
    paramIdx++;
  }
  if (exp.geo?.trim()) {
    conditions.push(`"geo" = $${paramIdx}`);
    params.push(exp.geo.trim());
    paramIdx++;
  }
  if (exp.brand?.trim()) {
    conditions.push(`"brand" = $${paramIdx}`);
    params.push(exp.brand.trim());
    paramIdx++;
  }
  if (exp.targetMetric?.trim()) {
    conditions.push(`"targetMetric" = $${paramIdx}`);
    params.push(exp.targetMetric.trim());
    paramIdx++;
  }

  if (conditions.length) {
    const scoreExpr = conditions
      .map((c) => `CASE WHEN ${c} THEN 1 ELSE 0 END`)
      .join(" + ");

    const sql = `
      SELECT "id", "experimentId", "testName", "monthlyExtrap",
             "screenshotThumbnailUrl", "screenshotWebUrl",
             (${scoreExpr}) AS score
      FROM "Experiment"
      WHERE "experimentId" != $1
        AND (${conditions.join(" OR ")})
      ORDER BY score DESC, COALESCE("monthlyExtrap", 0) DESC
      LIMIT ${maxSimilar}
    `;

    const similar = (await prisma.$queryRawUnsafe(sql, ...params)) as Array<{
      id: string;
      experimentId: string;
      testName: string | null;
      monthlyExtrap: number | null;
      screenshotThumbnailUrl: string | null;
      screenshotWebUrl: string | null;
      score: number;
    }>;

    for (const s of similar) {
      const sId = s.experimentId.trim();
      if (!sId || nodesMap.has(sId)) continue;
      nodesMap.set(sId, {
        id: sId,
        label: sId,
        type: "experiment",
        count: 2,
        href: `/experiments/${s.id}?from=${backParam}`,
        title: s.testName ?? undefined,
      });
      links.push({ source: expId, target: sId, value: 3 });
    }
  }

  return {
    nodes: Array.from(nodesMap.values()),
    links,
  };
}

/**
 * For the AI graph endpoint: aggregate experiment patterns (changeType → elementChanged)
 * with optional filters. Returns rows like { changeType, elementChanged, experimentCount }.
 */
export async function queryGraphPatterns(opts?: {
  vertical?: string;
  geo?: string;
  onlyFailed?: boolean;
  onlyWinners?: boolean;
  monthsBack?: number;
  limit?: number;
}): Promise<
  Array<{ changeType: string; elementChanged: string; experimentCount: number }>
> {
  const {
    vertical,
    geo,
    onlyFailed = false,
    onlyWinners = false,
    monthsBack = 12,
    limit = 200,
  } = opts ?? {};

  const where: string[] = [];
  const params: any[] = [];
  let idx = 1;

  // Date filter
  where.push(
    `(("dateConcluded" >= NOW() - INTERVAL '${monthsBack} months') OR ("dateLaunched" >= NOW() - INTERVAL '${monthsBack} months') OR ("dateConcluded" IS NULL AND "dateLaunched" IS NULL))`
  );

  // Non-null changeType and elementChanged
  where.push(`"changeType" IS NOT NULL AND "changeType" != ''`);
  where.push(`"elementChanged" IS NOT NULL AND "elementChanged" != ''`);

  if (vertical) {
    where.push(`"vertical" ILIKE $${idx}`);
    params.push(`%${vertical}%`);
    idx++;
  }
  if (geo) {
    where.push(`"geo" ILIKE $${idx}`);
    params.push(`%${geo}%`);
    idx++;
  }
  if (onlyFailed) {
    where.push(`("winningVar" IS NULL OR "winningVar" = '')`);
  }
  if (onlyWinners) {
    where.push(`"winningVar" IS NOT NULL AND "winningVar" != ''`);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const sql = `
    SELECT "changeType", "elementChanged", COUNT(*)::int AS "experimentCount"
    FROM "Experiment"
    ${whereClause}
    GROUP BY "changeType", "elementChanged"
    HAVING NOT (LOWER("changeType") = 'other' AND LOWER("elementChanged") = 'other')
    ORDER BY "experimentCount" DESC
    LIMIT ${limit}
  `;

  return (await prisma.$queryRawUnsafe(sql, ...params)) as Array<{
    changeType: string;
    elementChanged: string;
    experimentCount: number;
  }>;
}
