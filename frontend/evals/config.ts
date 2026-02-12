/**
 * OpenAI Evals Configuration for CRO Analyst
 * 
 * Following the approach from:
 * https://nicolalazzari.ai/articles/how-i-use-openai-evals-to-test-gpt-prompts-before-shipping-ai-features
 */

export const EVAL_CONFIG = {
  // Model used for grading SQL quality
  graderModel: "gpt-4o",
  
  // Model being tested (the one generating SQL)
  targetModel: "gpt-4o-mini",
  
  // Minimum pass rate to allow deployment
  ciThreshold: 0.85, // 85%
  
  // Minimum average GPT score to allow deployment
  minAverageScore: 7.0, // Out of 10
  
  // Categories and their weights for final scoring
  categoryWeights: {
    vertical: 1.5,      // Critical - vertical filtering
    geo: 1.5,           // Critical - geo filtering
    b2c_b2b: 2.0,       // Very critical - often misunderstood
    regional: 1.5,      // Critical - regional filtering
    dates: 1.0,         // Standard importance
    winners: 1.0,       // Standard importance
    person: 1.0,        // Standard importance
    aggregation: 0.8,   // Lower priority
    complex: 1.2,       // Higher complexity
    edge: 0.5           // Edge cases, lower priority
  },
  
  // SQL patterns that should NEVER appear (security/safety)
  forbiddenPatterns: [
    /\bINSERT\b/i,
    /\bUPDATE\b/i,
    /\bDELETE\b/i,
    /\bDROP\b/i,
    /\bALTER\b/i,
    /\bTRUNCATE\b/i,
    /\bCREATE\b/i,
    /--/,  // SQL comments (potential injection)
    /;.*;/  // Multiple statements
  ]
};

// Grading prompt for model-graded evaluation
export const GRADER_SYSTEM_PROMPT = `You are an expert query evaluator for a CRO (Conversion Rate Optimization) experiment database.

Your task is to grade the quality of generated queries against the expected behavior.
The system uses SQL (PostgreSQL) for all queries, including tabular data and graph/relationship pattern analysis.

FOR SQL QUERIES:
Database schema:
- Table: "Experiment" (quoted, case-sensitive)
- Key columns: experimentId, testName, vertical, geo, dateLaunched, dateConcluded, winningVar, monthlyExtrap, launchedBy, changeType, elementChanged, hypothesis, lessonLearned, tradingHub, crChangeV1, rpvChangeV1

SQL rules:
1. For vertical/geo filters: MUST use ILIKE with wildcards (e.g., "vertical" ILIKE '%Solar%')
2. For B2C/B2B: MUST filter on testName (e.g., "testName" ILIKE '%B2C%') - NOT a separate column
3. For Americas/regions: MUST filter on testName or tradingHub (e.g., "testName" ILIKE '%AME%')
4. For person queries: MUST filter on launchedBy (e.g., "launchedBy" ILIKE '%John%')
5. For winners: MUST include winningVar IS NOT NULL
6. Table and column names should be properly quoted
7. Should include reasonable LIMIT clause
8. Should use proper Postgres date syntax (INTERVAL, CURRENT_DATE)

FOR GRAPH/PATTERN QUERIES (also SQL):
- Graph patterns are derived via SQL aggregation on the Experiment table
- For pattern analysis: GROUP BY "changeType", "elementChanged" with COUNT(*)
- For vertical: "vertical" ILIKE '%Solar%'
- For relationships between entities: Use JOINs or self-joins on shared attributes
- Should include reasonable LIMIT clause

GRADING SCALE (1-10):
- 10: Perfect query - all criteria met, efficient, correct interpretation for the query type
- 8-9: Excellent - minor style issues but correct logic
- 6-7: Good - mostly correct but missing some filters or suboptimal approach
- 4-5: Partial - some correct elements but significant issues
- 2-3: Poor - wrong interpretation or major errors
- 1: Failed - completely wrong or unsafe query

RESPOND IN JSON ONLY:
{"score": <number 1-10>, "passed": <boolean>, "issues": ["issue1", "issue2"], "feedback": "<brief explanation>"}

A query "passes" if score >= 7.`;

export const GRADER_USER_TEMPLATE = `
QUESTION: {{question}}

EXPECTED BEHAVIOR: {{ideal}}

GENERATED QUERY:
{{sql}}

Grade this query. Return JSON only.`;
