/**
 * AI Evaluation Suite using OpenAI GPT for grading
 * 
 * Tests the CRO Analyst AI across multiple query categories:
 * - Vertical/Geo filtering
 * - B2C/B2B classification
 * - Regional filtering (Americas, RoW)
 * - Date ranges
 * - Winner/loser analysis
 * - Person-based queries
 * - Aggregations and rankings
 * 
 * Usage:
 *   DOTENV_CONFIG_PATH=.env.local NODE_OPTIONS='-r dotenv/config' npx tsx scripts/eval-ai.ts
 */

import 'dotenv/config';

const ENDPOINT = process.env.AI_TEST_ENDPOINT || "http://localhost:3000/api/ai/query";
const INTERNAL_KEY = process.env.AI_INTERNAL_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

interface TestCase {
  id: string;
  category: string;
  question: string;
  expectedPatterns: string[];  // SQL patterns that SHOULD appear
  forbiddenPatterns?: string[]; // SQL patterns that should NOT appear
  description: string;
}

interface EvalResult {
  id: string;
  category: string;
  question: string;
  passed: boolean;
  sql: string | null;
  error: string | null;
  patternResults: { pattern: string; found: boolean; expected: boolean }[];
  gptScore: number | null;
  gptFeedback: string | null;
  rowCount: number;
}

// Comprehensive test cases
const TEST_CASES: TestCase[] = [
  // ===== VERTICAL FILTERING =====
  {
    id: "v1",
    category: "vertical",
    question: "Show me hearing aids experiments",
    expectedPatterns: ["ILIKE", "%Hearing%", "vertical"],
    forbiddenPatterns: ["launchedBy"],
    description: "Should filter by vertical using ILIKE"
  },
  {
    id: "v2",
    category: "vertical",
    question: "What tests did we run on solar panels?",
    expectedPatterns: ["ILIKE", "%Solar%", "vertical"],
    description: "Should filter solar panels vertical"
  },
  {
    id: "v3",
    category: "vertical",
    question: "Heat pumps experiments in the last 3 months",
    expectedPatterns: ["ILIKE", "%Heat%", "vertical", "INTERVAL"],
    description: "Should combine vertical filter with date range"
  },
  {
    id: "v4",
    category: "vertical",
    question: "Merchant accounts tests this year",
    expectedPatterns: ["ILIKE", "%Merchant%", "vertical"],
    description: "Should filter merchant accounts vertical"
  },

  // ===== GEO FILTERING =====
  {
    id: "g1",
    category: "geo",
    question: "List all UK experiments",
    expectedPatterns: ["ILIKE", "%UK%", "geo"],
    description: "Should filter by UK geo"
  },
  {
    id: "g2",
    category: "geo",
    question: "Show me Denmark tests from 2025",
    expectedPatterns: ["ILIKE", "geo"],
    description: "Should filter by DK/Denmark geo"
  },
  {
    id: "g3",
    category: "geo",
    question: "Hearing aids DK tests for the last 6 months",
    expectedPatterns: ["ILIKE", "%Hearing%", "vertical", "geo"],
    forbiddenPatterns: ["launchedBy ILIKE '%Hearing%'"],
    description: "Combined vertical + geo filter"
  },
  {
    id: "g4",
    category: "geo",
    question: "What worked well in Germany?",
    expectedPatterns: ["ILIKE", "geo", "winningVar"],
    description: "Should filter by DE/Germany geo with winner filter"
  },

  // ===== B2C/B2B FILTERING =====
  {
    id: "b1",
    category: "b2c_b2b",
    question: "Show me B2C experiments",
    expectedPatterns: ["testName", "ILIKE", "%B2C%"],
    description: "Should filter B2C from testName"
  },
  {
    id: "b2",
    category: "b2c_b2b",
    question: "List B2B tests from last year",
    expectedPatterns: ["testName", "ILIKE", "%B2B%"],
    description: "Should filter B2B from testName"
  },
  {
    id: "b3",
    category: "b2c_b2b",
    question: "What is the largest win in 2025 for B2C Americas?",
    expectedPatterns: ["testName", "ILIKE", "%B2C%", "AME", "monthlyExtrap", "DESC"],
    description: "Should filter B2C + Americas region + largest win"
  },
  {
    id: "b4",
    category: "b2c_b2b",
    question: "Compare B2C vs B2B win rates",
    expectedPatterns: ["testName", "ILIKE"],
    description: "Should handle B2C/B2B comparison query"
  },

  // ===== REGIONAL FILTERING =====
  {
    id: "r1",
    category: "regional",
    question: "Americas experiments this quarter",
    expectedPatterns: ["ILIKE", "AME"],
    description: "Should filter Americas region"
  },
  {
    id: "r2",
    category: "regional",
    question: "Show me RoW (rest of world) tests",
    expectedPatterns: ["ILIKE", "RoW"],
    description: "Should filter Rest of World"
  },
  {
    id: "r3",
    category: "regional",
    question: "Top winners in Americas region",
    expectedPatterns: ["ILIKE", "monthlyExtrap", "DESC"],
    description: "Should filter Americas + rank by wins"
  },

  // ===== DATE RANGES =====
  {
    id: "d1",
    category: "dates",
    question: "How many experiments concluded in October 2025?",
    expectedPatterns: ["dateConcluded", "2025-10"],
    description: "Should filter by specific month"
  },
  {
    id: "d2",
    category: "dates",
    question: "Experiments from Q1 2025",
    expectedPatterns: ["dateConcluded", "2025"],
    description: "Should handle quarter filtering"
  },
  {
    id: "d3",
    category: "dates",
    question: "What did we test last month?",
    expectedPatterns: ["INTERVAL", "month"],
    description: "Should use relative date"
  },
  {
    id: "d4",
    category: "dates",
    question: "Tests launched between January and March 2025",
    expectedPatterns: ["dateLaunched", "2025-01", "2025-03"],
    description: "Should handle date range"
  },

  // ===== WINNERS/LOSERS =====
  {
    id: "w1",
    category: "winners",
    question: "What are our biggest wins this year?",
    expectedPatterns: ["monthlyExtrap", "DESC", "winningVar", "IS NOT NULL"],
    description: "Should filter winners and order by impact"
  },
  {
    id: "w2",
    category: "winners",
    question: "Top 10 experiments by monthly extrapolation",
    expectedPatterns: ["monthlyExtrap", "DESC", "LIMIT 10"],
    description: "Should rank by monthlyExtrap"
  },
  {
    id: "w3",
    category: "winners",
    question: "What experiments failed recently?",
    expectedPatterns: ["winningVar"],
    description: "Should identify failed experiments"
  },
  {
    id: "w4",
    category: "winners",
    question: "Show me flat tests (no significant result)",
    expectedPatterns: ["winningVar", "NULL"],
    description: "Should find inconclusive tests"
  },

  // ===== PERSON QUERIES =====
  {
    id: "p1",
    category: "person",
    question: "What experiments did John run?",
    expectedPatterns: ["launchedBy", "ILIKE", "%John%"],
    description: "Should filter by person name"
  },
  {
    id: "p2",
    category: "person",
    question: "Tests by Sarah in the last 6 months",
    expectedPatterns: ["launchedBy", "ILIKE", "%Sarah%", "INTERVAL"],
    description: "Should combine person + date filter"
  },

  // ===== AGGREGATIONS =====
  {
    id: "a1",
    category: "aggregation",
    question: "How many experiments per vertical?",
    expectedPatterns: ["GROUP BY", "vertical", "COUNT"],
    description: "Should group by vertical"
  },
  {
    id: "a2",
    category: "aggregation",
    question: "Average win rate by geo",
    expectedPatterns: ["GROUP BY", "geo"],
    description: "Should calculate metrics by geo"
  },
  {
    id: "a3",
    category: "aggregation",
    question: "Monthly experiment count for 2025",
    expectedPatterns: ["GROUP BY", "2025"],
    description: "Should group by month"
  },

  // ===== COMPLEX QUERIES =====
  {
    id: "c1",
    category: "complex",
    question: "What CTA tests worked best on Solar Panels UK in 2025?",
    expectedPatterns: ["ILIKE", "%Solar%", "UK", "CTA", "winningVar"],
    description: "Complex: vertical + geo + change type + winner"
  },
  {
    id: "c2",
    category: "complex",
    question: "Compare form changes vs button changes - which performed better?",
    expectedPatterns: ["changeType", "elementChanged"],
    description: "Should analyze by change type/element"
  },
  {
    id: "c3",
    category: "complex",
    question: "What lessons did we learn from failed overlay tests?",
    expectedPatterns: ["lessonLearned", "overlay"],
    description: "Should find lessons from specific test type"
  },

  // ===== EDGE CASES =====
  {
    id: "e1",
    category: "edge",
    question: "Show me experiments",
    expectedPatterns: ["SELECT", "Experiment", "LIMIT"],
    description: "Basic query should still work"
  },
  {
    id: "e2",
    category: "edge",
    question: "List experiments with hypothesis containing 'trust'",
    expectedPatterns: ["hypothesis", "ILIKE", "%trust%"],
    description: "Should search in hypothesis field"
  },
  {
    id: "e3",
    category: "edge",
    question: "Experiments with CR change greater than 5%",
    expectedPatterns: ["crChangeV1", ">"],
    description: "Should filter by metric threshold"
  }
];

async function callAI(question: string): Promise<{ sql: string | null; rowCount: number; error: string | null }> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (INTERNAL_KEY) headers["x-internal-api-key"] = INTERNAL_KEY;
    
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ question })
    });
    
    const json = await res.json();
    
    if (!res.ok) {
      return { sql: null, rowCount: 0, error: json.error || res.statusText };
    }
    
    return { sql: json.sql || null, rowCount: json.rowCount || 0, error: null };
  } catch (err) {
    return { sql: null, rowCount: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function gradeWithGPT(testCase: TestCase, sql: string): Promise<{ score: number; feedback: string }> {
  if (!OPENAI_API_KEY) {
    return { score: -1, feedback: "OpenAI API key not configured" };
  }

  const prompt = `You are evaluating SQL query generation for a CRO (Conversion Rate Optimization) experiment database.

Test Case: ${testCase.description}
Question: "${testCase.question}"
Expected patterns: ${testCase.expectedPatterns.join(", ")}
${testCase.forbiddenPatterns ? `Forbidden patterns: ${testCase.forbiddenPatterns.join(", ")}` : ""}

Generated SQL:
${sql}

Evaluate the SQL on a scale of 1-10:
- 10: Perfect - correctly interprets the question, uses proper filters, efficient query
- 7-9: Good - mostly correct, minor issues
- 4-6: Partial - some correct elements but missing key filters or wrong interpretation
- 1-3: Poor - fundamentally wrong approach

Consider:
1. Does it correctly filter by the intended criteria (vertical, geo, B2C/B2B, dates)?
2. Does it use ILIKE with wildcards for flexible text matching?
3. Is the query efficient and well-structured?
4. Would this query return the data the user actually wants?

Respond in JSON format only:
{"score": <number>, "feedback": "<one line explanation>"}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.1
      })
    });

    if (!res.ok) {
      const text = await res.text();
      return { score: -1, feedback: `GPT error: ${text.slice(0, 100)}` };
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    
    // Parse JSON response
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return { score: parsed.score || 0, feedback: parsed.feedback || "" };
    }
    
    return { score: -1, feedback: "Could not parse GPT response" };
  } catch (err) {
    return { score: -1, feedback: `GPT call failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function checkPatterns(sql: string, expectedPatterns: string[], forbiddenPatterns?: string[]): { pattern: string; found: boolean; expected: boolean }[] {
  const results: { pattern: string; found: boolean; expected: boolean }[] = [];
  const upperSql = sql.toUpperCase();
  
  for (const pattern of expectedPatterns) {
    const found = upperSql.includes(pattern.toUpperCase());
    results.push({ pattern, found, expected: true });
  }
  
  if (forbiddenPatterns) {
    for (const pattern of forbiddenPatterns) {
      const found = upperSql.includes(pattern.toUpperCase());
      results.push({ pattern, found, expected: false });
    }
  }
  
  return results;
}

async function runEval(): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  const categories = new Map<string, { passed: number; total: number; avgScore: number; scores: number[] }>();
  
  console.log("🧪 Starting AI Evaluation Suite");
  console.log(`📊 ${TEST_CASES.length} test cases across ${new Set(TEST_CASES.map(t => t.category)).size} categories`);
  console.log(`🎯 Endpoint: ${ENDPOINT}`);
  console.log(`🤖 GPT Grading: ${OPENAI_API_KEY ? "Enabled" : "Disabled"}`);
  console.log("\n" + "=".repeat(80) + "\n");

  for (const testCase of TEST_CASES) {
    process.stdout.write(`[${testCase.id}] ${testCase.category.padEnd(12)} `);
    
    const { sql, rowCount, error } = await callAI(testCase.question);
    
    let passed = false;
    let patternResults: { pattern: string; found: boolean; expected: boolean }[] = [];
    let gptScore: number | null = null;
    let gptFeedback: string | null = null;
    
    if (error) {
      console.log(`❌ Error: ${error.slice(0, 50)}`);
    } else if (sql) {
      patternResults = checkPatterns(sql, testCase.expectedPatterns, testCase.forbiddenPatterns);
      
      // Check if all expected patterns found and no forbidden patterns found
      const expectedPassed = patternResults
        .filter(r => r.expected)
        .every(r => r.found);
      const forbiddenPassed = patternResults
        .filter(r => !r.expected)
        .every(r => !r.found);
      
      passed = expectedPassed && forbiddenPassed;
      
      // GPT grading
      if (OPENAI_API_KEY) {
        const gptResult = await gradeWithGPT(testCase, sql);
        gptScore = gptResult.score;
        gptFeedback = gptResult.feedback;
      }
      
      const icon = passed ? "✅" : "⚠️";
      const scoreStr = gptScore !== null && gptScore >= 0 ? ` [GPT: ${gptScore}/10]` : "";
      console.log(`${icon} ${testCase.question.slice(0, 40).padEnd(40)}${scoreStr} (${rowCount} rows)`);
      
      if (!passed) {
        const missing = patternResults.filter(r => r.expected && !r.found).map(r => r.pattern);
        const forbidden = patternResults.filter(r => !r.expected && r.found).map(r => r.pattern);
        if (missing.length) console.log(`   Missing: ${missing.join(", ")}`);
        if (forbidden.length) console.log(`   Forbidden found: ${forbidden.join(", ")}`);
        console.log(`   SQL: ${sql.slice(0, 100)}...`);
      }
    }
    
    results.push({
      id: testCase.id,
      category: testCase.category,
      question: testCase.question,
      passed,
      sql,
      error,
      patternResults,
      gptScore,
      gptFeedback,
      rowCount
    });
    
    // Track category stats
    const cat = categories.get(testCase.category) || { passed: 0, total: 0, avgScore: 0, scores: [] };
    cat.total++;
    if (passed) cat.passed++;
    if (gptScore !== null && gptScore >= 0) cat.scores.push(gptScore);
    categories.set(testCase.category, cat);
    
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  // Print summary
  console.log("\n" + "=".repeat(80));
  console.log("\n📈 EVALUATION SUMMARY\n");
  
  let totalPassed = 0;
  let totalTests = 0;
  let allScores: number[] = [];
  
  for (const [category, stats] of categories) {
    totalPassed += stats.passed;
    totalTests += stats.total;
    allScores = allScores.concat(stats.scores);
    
    const pct = ((stats.passed / stats.total) * 100).toFixed(0);
    const avgScore = stats.scores.length > 0 
      ? (stats.scores.reduce((a, b) => a + b, 0) / stats.scores.length).toFixed(1)
      : "N/A";
    
    console.log(`${category.padEnd(15)} ${stats.passed}/${stats.total} (${pct}%)`.padEnd(30) + `Avg GPT Score: ${avgScore}`);
  }
  
  console.log("\n" + "-".repeat(50));
  const totalPct = ((totalPassed / totalTests) * 100).toFixed(1);
  const overallAvg = allScores.length > 0 
    ? (allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(1)
    : "N/A";
  
  console.log(`TOTAL: ${totalPassed}/${totalTests} pattern checks passed (${totalPct}%)`);
  console.log(`OVERALL GPT SCORE: ${overallAvg}/10`);
  
  // Identify weakest areas
  const failed = results.filter(r => !r.passed && !r.error);
  if (failed.length > 0) {
    console.log("\n⚠️  AREAS NEEDING IMPROVEMENT:");
    failed.forEach(f => {
      console.log(`   - [${f.id}] ${f.question.slice(0, 60)}`);
      if (f.gptFeedback) console.log(`     GPT: ${f.gptFeedback}`);
    });
  }
  
  return results;
}

// Export results to JSON for further analysis
async function main() {
  const results = await runEval();
  
  // Save detailed results
  const outputPath = "./eval-results.json";
  const fs = await import("fs");
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n📁 Detailed results saved to ${outputPath}`);
}

main().catch(console.error);
