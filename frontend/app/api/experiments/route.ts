import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("pageSize") ?? "25") || 25)
  );
  const skip = (page - 1) * pageSize;

  const [items, total] = await Promise.all([
    prisma.experiment.findMany({
      orderBy: { dateLaunched: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        experimentId: true,
        testName: true,
        vertical: true,
        geo: true,
        dateLaunched: true,
        dateConcluded: true,
        winningVar: true
      }
    }),
    prisma.experiment.count()
  ]);

  return NextResponse.json({
    items,
    page,
    pageSize,
    total
  });
}

