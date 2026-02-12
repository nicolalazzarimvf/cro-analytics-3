import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "eval-results.json");
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "No eval results found. Run `npm run eval` first." }, { status: 404 });
    }
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load eval results" },
      { status: 500 },
    );
  }
}
