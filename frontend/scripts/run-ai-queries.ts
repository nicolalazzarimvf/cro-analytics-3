/**
 * Runs a list of questions against the local AI query endpoint and prints the SQL + notes.
 *
 * Usage:
 *   1) Ensure `npm run dev` is running on http://localhost:3000 and env keys are set.
 *   2) In another terminal: cd frontend && npx tsx scripts/run-ai-queries.ts
 */

const QUESTIONS: string[] = [
  "How many experiments did we do in June 2024?",
  "Show me what we tested on Merchant Accounts UK in the past 6 months. What has worked well, what hasn’t? What are your recommendations for test opportunities?",
  "What patterns can we see in failed experiments?",
  "What has been tested on Solar Panels UK in the last 3 months? What did we learn?",
  "Please give me a summary of all experiments concluded in October 2025",
  "What did we learn from experiments that include OverlayLoader in the name?",
  "Top winners by monthly extrap in 2025"
];

import { config as loadEnv } from "dotenv";

// Load local env first, then fallback to .env
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const ENDPOINT = process.env.AI_TEST_ENDPOINT || "http://localhost:3000/api/ai/query";
const INTERNAL_KEY = process.env.AI_INTERNAL_API_KEY;

async function run() {
  for (const question of QUESTIONS) {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (INTERNAL_KEY) headers["x-internal-api-key"] = INTERNAL_KEY;
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({ question })
      });
      const json = await res.json();
      console.log("\n=== Question ===");
      console.log(question);
      if (!res.ok) {
        console.log("Error:", json.error || res.statusText);
        continue;
      }
      console.log("SQL:", json.sql);
      if (json.notes) console.log("Notes:", json.notes);
      console.log("Rows:", json.rowCount, json.truncated ? "(truncated for UI)" : "");
    } catch (err) {
      console.log("Failed:", err);
    }
  }
}

run();
