import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

/**
 * GET /api/graph/full
 *
 * Build a full knowledge graph from ALL experiments in the database.
 * Returns { nodes, links } with experiment nodes + attribute nodes
 * (changeType, elementChanged, vertical, geo, brand).
 */
export async function GET() {
  const experiments = await prisma.experiment.findMany({
    select: {
      id: true,
      experimentId: true,
      testName: true,
      changeType: true,
      elementChanged: true,
      vertical: true,
      geo: true,
      brand: true,
      winningVar: true,
      monthlyExtrap: true,
    },
  });

  type GNode = {
    id: string;
    label: string;
    type: string;
    count: number;
    href?: string;
    title?: string;
    winner?: boolean;
  };

  const nodesMap = new Map<string, GNode>();
  const links: Array<{ source: string; target: string; value: number }> = [];

  // Attribute node helper — reuses existing nodes, incrementing count
  function addAttr(expNodeId: string, value: string | null | undefined, type: string) {
    const v = (value ?? "").trim();
    if (!v) return;
    const attrId = `${type}::${v}`;
    const existing = nodesMap.get(attrId);
    if (existing) {
      existing.count += 1;
    } else {
      nodesMap.set(attrId, { id: attrId, label: v, type, count: 1 });
    }
    links.push({ source: expNodeId, target: attrId, value: 1 });
  }

  for (const exp of experiments) {
    const eid = exp.experimentId.trim();
    if (!eid) continue;

    const isWinner =
      !!exp.winningVar &&
      exp.winningVar.trim() !== "" &&
      exp.winningVar.trim().toLowerCase() !== "control";

    nodesMap.set(eid, {
      id: eid,
      label: eid,
      type: "experiment",
      count: 1,
      href: `/experiments/${exp.id}?from=graph`,
      title: exp.testName ?? undefined,
      winner: isWinner,
    });

    addAttr(eid, exp.changeType, "change");
    addAttr(eid, exp.elementChanged, "element");
    addAttr(eid, exp.vertical, "vertical");
    addAttr(eid, exp.geo, "geo");
    addAttr(eid, exp.brand, "brand");
  }

  return NextResponse.json({
    nodes: Array.from(nodesMap.values()),
    links,
    experimentCount: experiments.length,
  });
}
