import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export async function GET() {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      db: "connected",
      elapsedMs: Date.now() - startedAt
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        db: "error",
        elapsedMs: Date.now() - startedAt
      },
      { status: 500 }
    );
  }
}

