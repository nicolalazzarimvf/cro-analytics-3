import { prisma } from "../db/client";
import { getNeo4jSession } from "./client";

type ExperimentLite = {
  experimentId: string;
  testName: string;
  vertical: string | null;
  geo: string | null;
  brand: string | null;
  dateLaunched: Date | null;
  dateConcluded: Date | null;
  winningVar: string | null;
  monthlyExtrap: number | null;
  targetMetric: string | null;
  changeType: string | null;
  elementChanged: string | null;
  primarySignificance1: number | null;
  crChangeV1: number | null;
  rpvChangeV1: number | null;
  hypothesis: string | null;
  lessonLearned: string | null;
};

function cleanValue(value: unknown) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return String(value);
  return value;
}

/**
 * Upserts experiments into Neo4j and connects to Vertical/Geo/Brand nodes.
 * Keeps things simple: one node per experimentId, with basic properties and
 * 3 relationship types.
 */
export async function syncExperimentsToNeo4j(limit = 500) {
  const query: Parameters<typeof prisma.experiment.findMany>[0] = {
    orderBy: { updatedAt: "desc" },
    select: {
      experimentId: true,
      testName: true,
      vertical: true,
      geo: true,
      brand: true,
      dateLaunched: true,
      dateConcluded: true,
      winningVar: true,
      monthlyExtrap: true,
      targetMetric: true,
      changeType: true,
      elementChanged: true,
      primarySignificance1: true,
      crChangeV1: true,
      rpvChangeV1: true,
      hypothesis: true,
      lessonLearned: true
    }
  };
  if (limit > 0) {
    query.take = limit;
  }

  const experiments = await prisma.experiment.findMany(query);

  if (!experiments.length) return { synced: 0 };

  const session = await getNeo4jSession();

  try {
    for (const exp of experiments) {
      await session.run(
        `
        MERGE (e:Experiment {experimentId: $experimentId})
        SET e.testName = $testName,
            e.dateLaunched = $dateLaunched,
            e.dateConcluded = $dateConcluded,
            e.winningVar = $winningVar,
            e.monthlyExtrap = $monthlyExtrap,
            e.targetMetric = $targetMetric,
            e.changeType = $changeType,
            e.elementChanged = $elementChanged,
            e.primarySignificance1 = $primarySignificance1,
            e.crChangeV1 = $crChangeV1,
            e.rpvChangeV1 = $rpvChangeV1,
            e.hypothesis = $hypothesis,
            e.lessonLearned = $lessonLearned
        WITH e
        CALL {
          WITH e
          WITH e, $vertical AS v
          WHERE v IS NOT NULL AND trim(v) <> ""
          MERGE (vert:Vertical {name: v})
          MERGE (e)-[:IN_VERTICAL]->(vert)
        }
        CALL {
          WITH e
          WITH e, $geo AS g
          WHERE g IS NOT NULL AND trim(g) <> ""
          MERGE (geo:Geo {code: g})
          MERGE (e)-[:IN_GEO]->(geo)
        }
        CALL {
          WITH e
          WITH e, $brand AS b
          WHERE b IS NOT NULL AND trim(b) <> ""
          MERGE (brand:Brand {name: b})
          MERGE (e)-[:FOR_BRAND]->(brand)
        }
        CALL {
          WITH e
          WITH e, $targetMetric AS t
          WHERE t IS NOT NULL AND trim(t) <> ""
          MERGE (tm:TargetMetric {name: t})
          MERGE (e)-[:TARGETS]->(tm)
        }
        CALL {
          WITH e
          WITH e, $changeType AS ct
          WHERE ct IS NOT NULL AND trim(ct) <> ""
          MERGE (ctNode:ChangeType {name: ct})
          MERGE (e)-[:HAS_CHANGE_TYPE]->(ctNode)
        }
        CALL {
          WITH e
          WITH e, $elementChanged AS el
          WHERE el IS NOT NULL AND trim(el) <> ""
          MERGE (elNode:ElementChanged {name: el})
          MERGE (e)-[:CHANGED_ELEMENT]->(elNode)
        }
        RETURN e
        `,
        {
          experimentId: cleanValue(exp.experimentId),
          testName: cleanValue(exp.testName),
          vertical: cleanValue(exp.vertical),
          geo: cleanValue(exp.geo),
          brand: cleanValue(exp.brand),
          dateLaunched: cleanValue(exp.dateLaunched),
          dateConcluded: cleanValue(exp.dateConcluded),
          winningVar: cleanValue(exp.winningVar),
          monthlyExtrap: cleanValue(exp.monthlyExtrap),
          targetMetric: cleanValue(exp.targetMetric),
          changeType: cleanValue(exp.changeType),
          elementChanged: cleanValue(exp.elementChanged),
          primarySignificance1: cleanValue(exp.primarySignificance1),
          crChangeV1: cleanValue(exp.crChangeV1),
          rpvChangeV1: cleanValue(exp.rpvChangeV1),
          hypothesis: cleanValue(exp.hypothesis),
          lessonLearned: cleanValue(exp.lessonLearned)
        }
      );
    }

    await session.close();
    return { synced: experiments.length };
  } catch (err) {
    await session.close().catch(() => {});
    throw err;
  }
}
