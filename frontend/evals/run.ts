/**
 * OpenAI Evals Runner for CRO Analyst
 * 
 * Model-graded evaluation following the approach from:
 * https://nicolalazzari.ai/articles/how-i-use-openai-evals-to-test-gpt-prompts-before-shipping-ai-features
 * 
 * Usage:
 *   npm run eval              # Run against local dev server
 *   npm run eval:prod         # Run against production
 *   npm run eval:ci           # CI mode - exits with code 1 if below threshold
 * 
 * Environment variables:
 *   AI_TEST_ENDPOINT     - API endpoint to test (default: localhost:3000)
 *   OPENAI_API_KEY       - Required for model-graded evaluation
 *   AI_INTERNAL_API_KEY  - API key for authenticating with CRO Analyst
 *   EVAL_CI_MODE         - Set to 'true' for CI/CD (fails on threshold breach)
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { EVAL_CONFIG, GRADER_SYSTEM_PROMPT, GRADER_USER_TEMPLATE } from './config.js';

// ES Module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Types
interface TestCase {
  input: string;
  ideal: string;
  category: string;
  critical: boolean;
}

interface GraderResponse {
  score: number;
  passed: boolean;
  issues: string[];
  feedback: string;
}

interface EvalResult {
  id: number;
  input: string;
  ideal: string;
  category: string;
  critical: boolean;
  sql: string | null;
  cypher: string | null;
  modeUsed: string | null;
  error: string | null;
  graderScore: number;
  graderPassed: boolean;
  graderIssues: string[];
  graderFeedback: string;
  safetyPassed: boolean;
  latencyMs: number;
}

interface EvalSummary {
  totalTests: number;
  passed: number;
  failed: number;
  errors: number;
  passRate: number;
  averageScore: number;
  averageLatency: number;
  criticalPassRate: number;
  byCategory: Record<string, { passed: number; total: number; avgScore: number }>;
  ciPassed: boolean;
  timestamp: string;
}

// Configuration
const SQL_ENDPOINT = process.env.AI_TEST_ENDPOINT || 'http://localhost:3000/api/ai/query';
const ASK_ENDPOINT = SQL_ENDPOINT.replace('/api/ai/query', '/api/ai/ask');
const INTERNAL_KEY = process.env.AI_INTERNAL_API_KEY;
const CI_MODE = process.env.EVAL_CI_MODE === 'true';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Load test cases from JSONL dataset
 */
function loadTestCases(): TestCase[] {
  const datasetPath = path.join(__dirname, 'cro_sql_dataset.jsonl');
  const content = fs.readFileSync(datasetPath, 'utf-8');
  
  return content
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as TestCase);
}

/**
 * Call the CRO Analyst API to generate SQL or Cypher
 */
async function generateQuery(question: string, category: string): Promise<{ sql: string | null; cypher: string | null; modeUsed: string | null; error: string | null; latencyMs: number }> {
  const startTime = Date.now();
  const isGraphTest = category === 'graph';
  const endpoint = isGraphTest ? ASK_ENDPOINT : SQL_ENDPOINT;
  
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (INTERNAL_KEY) headers['x-internal-api-key'] = INTERNAL_KEY;
    
    const body = isGraphTest 
      ? { question, mode: 'auto' }  // Let auto-routing work
      : { question };
    
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    
    const latencyMs = Date.now() - startTime;
    const json = await res.json();
    
    if (!res.ok) {
      return { sql: null, cypher: null, modeUsed: null, error: json.error || `HTTP ${res.status}`, latencyMs };
    }
    
    return { 
      sql: json.sql || null, 
      cypher: json.cypher || null,
      modeUsed: json.modeUsed || (json.sql ? 'sql' : null),
      error: null, 
      latencyMs 
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    return { sql: null, cypher: null, modeUsed: null, error: err instanceof Error ? err.message : String(err), latencyMs };
  }
}

/**
 * Check SQL for forbidden patterns (security)
 */
function checkSafety(sql: string): boolean {
  for (const pattern of EVAL_CONFIG.forbiddenPatterns) {
    if (pattern.test(sql)) {
      return false;
    }
  }
  return true;
}

/**
 * Model-graded evaluation using GPT-4
 */
async function gradeWithModel(question: string, ideal: string, query: string, isGraph: boolean = false): Promise<GraderResponse> {
  const queryType = isGraph ? 'Cypher' : 'SQL';
  const userPrompt = GRADER_USER_TEMPLATE
    .replace('{{question}}', question)
    .replace('{{ideal}}', ideal)
    .replace('{{sql}}', `[${queryType}] ${query}`);
  
  try {
    const response = await openai.chat.completions.create({
      model: EVAL_CONFIG.graderModel,
      messages: [
        { role: 'system', content: GRADER_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 500
    });
    
    const content = response.choices[0]?.message?.content || '';
    
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        score: parsed.score || 0,
        passed: parsed.passed ?? (parsed.score >= 7),
        issues: parsed.issues || [],
        feedback: parsed.feedback || ''
      };
    }
    
    return { score: 0, passed: false, issues: ['Could not parse grader response'], feedback: content };
  } catch (err) {
    return {
      score: 0,
      passed: false,
      issues: [`Grader error: ${err instanceof Error ? err.message : String(err)}`],
      feedback: ''
    };
  }
}

/**
 * Run a single evaluation
 */
async function runSingleEval(testCase: TestCase, id: number): Promise<EvalResult> {
  const { sql, cypher, modeUsed, error, latencyMs } = await generateQuery(testCase.input, testCase.category);
  
  const isGraphTest = testCase.category === 'graph';
  const query = isGraphTest ? (cypher || sql) : sql; // Graph tests can also fall back to SQL
  
  if (error || !query) {
    return {
      id,
      input: testCase.input,
      ideal: testCase.ideal,
      category: testCase.category,
      critical: testCase.critical,
      sql,
      cypher,
      modeUsed,
      error: error || `No ${isGraphTest ? 'query' : 'SQL'} generated`,
      graderScore: 0,
      graderPassed: false,
      graderIssues: [`No ${isGraphTest ? 'query' : 'SQL'} to evaluate`],
      graderFeedback: '',
      safetyPassed: true,
      latencyMs
    };
  }
  
  // Safety check (only for SQL, Cypher has its own safety checks)
  const safetyPassed = !sql || checkSafety(sql);
  
  // Model-graded evaluation - pass query type info to grader
  const graderResult = await gradeWithModel(testCase.input, testCase.ideal, query, isGraphTest);
  
  return {
    id,
    input: testCase.input,
    ideal: testCase.ideal,
    category: testCase.category,
    critical: testCase.critical,
    sql,
    cypher,
    modeUsed,
    error: null,
    graderScore: graderResult.score,
    graderPassed: graderResult.passed && safetyPassed,
    graderIssues: graderResult.issues,
    graderFeedback: graderResult.feedback,
    safetyPassed,
    latencyMs
  };
}

/**
 * Calculate summary statistics
 */
function calculateSummary(results: EvalResult[]): EvalSummary {
  const passed = results.filter(r => r.graderPassed).length;
  const failed = results.filter(r => !r.graderPassed && !r.error).length;
  const errors = results.filter(r => !!r.error).length;
  
  const scores = results.filter(r => r.graderScore > 0).map(r => r.graderScore);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  
  const latencies = results.map(r => r.latencyMs);
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  
  const criticalTests = results.filter(r => r.critical);
  const criticalPassed = criticalTests.filter(r => r.graderPassed).length;
  const criticalPassRate = criticalTests.length > 0 ? criticalPassed / criticalTests.length : 1;
  
  // By category stats
  const byCategory: Record<string, { passed: number; total: number; avgScore: number }> = {};
  for (const result of results) {
    if (!byCategory[result.category]) {
      byCategory[result.category] = { passed: 0, total: 0, avgScore: 0 };
    }
    byCategory[result.category].total++;
    if (result.graderPassed) byCategory[result.category].passed++;
  }
  
  // Calculate avg score per category
  for (const cat of Object.keys(byCategory)) {
    const catResults = results.filter(r => r.category === cat && r.graderScore > 0);
    byCategory[cat].avgScore = catResults.length > 0
      ? catResults.reduce((a, r) => a + r.graderScore, 0) / catResults.length
      : 0;
  }
  
  const passRate = results.length > 0 ? passed / results.length : 0;
  
  // CI threshold check
  const ciPassed = passRate >= EVAL_CONFIG.ciThreshold && 
                   avgScore >= EVAL_CONFIG.minAverageScore &&
                   criticalPassRate >= 0.9; // 90% critical tests must pass
  
  return {
    totalTests: results.length,
    passed,
    failed,
    errors,
    passRate,
    averageScore: avgScore,
    averageLatency: avgLatency,
    criticalPassRate,
    byCategory,
    ciPassed,
    timestamp: new Date().toISOString()
  };
}

/**
 * Print results to console
 */
function printResults(results: EvalResult[], summary: EvalSummary): void {
  console.log('\n' + '═'.repeat(80));
  console.log('🧪 CRO ANALYST - OPENAI EVALS RESULTS');
  console.log('═'.repeat(80));
  console.log(`📍 SQL Endpoint: ${SQL_ENDPOINT}`);
  console.log(`📍 Ask Endpoint: ${ASK_ENDPOINT}`);
  console.log(`🤖 Grader Model: ${EVAL_CONFIG.graderModel}`);
  console.log(`📊 Total Tests: ${summary.totalTests}`);
  console.log('═'.repeat(80) + '\n');
  
  // Individual results
  for (const result of results) {
    const icon = result.error ? '❌' : (result.graderPassed ? '✅' : '⚠️');
    const scoreStr = result.graderScore > 0 ? `[${result.graderScore}/10]` : '[--]';
    const criticalStr = result.critical ? '🔴' : '⚪';
    const modeStr = result.modeUsed ? `(${result.modeUsed})` : '';
    
    console.log(`${icon} ${criticalStr} [${result.category.padEnd(12)}] ${scoreStr} ${modeStr.padEnd(7)} ${result.input.slice(0, 45).padEnd(45)}`);
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    } else if (!result.graderPassed) {
      if (result.graderIssues.length > 0) {
        console.log(`   Issues: ${result.graderIssues.join('; ')}`);
      }
      if (result.graderFeedback) {
        console.log(`   Feedback: ${result.graderFeedback.slice(0, 100)}`);
      }
      const queryToShow = result.cypher || result.sql;
      if (queryToShow) {
        const queryType = result.cypher ? 'Cypher' : 'SQL';
        console.log(`   ${queryType}: ${queryToShow.slice(0, 80)}...`);
      }
    }
  }
  
  // Summary
  console.log('\n' + '─'.repeat(80));
  console.log('📈 SUMMARY BY CATEGORY\n');
  
  for (const [category, stats] of Object.entries(summary.byCategory)) {
    const pct = ((stats.passed / stats.total) * 100).toFixed(0);
    const bar = '█'.repeat(Math.round(stats.passed / stats.total * 20)).padEnd(20, '░');
    console.log(`${category.padEnd(15)} ${bar} ${stats.passed}/${stats.total} (${pct}%) avg: ${stats.avgScore.toFixed(1)}`);
  }
  
  // Overall
  console.log('\n' + '─'.repeat(80));
  console.log('📊 OVERALL METRICS\n');
  console.log(`   Pass Rate:      ${(summary.passRate * 100).toFixed(1)}% (threshold: ${EVAL_CONFIG.ciThreshold * 100}%)`);
  console.log(`   Average Score:  ${summary.averageScore.toFixed(2)}/10 (threshold: ${EVAL_CONFIG.minAverageScore})`);
  console.log(`   Critical Tests: ${(summary.criticalPassRate * 100).toFixed(1)}% passed (threshold: 90%)`);
  console.log(`   Avg Latency:    ${summary.averageLatency.toFixed(0)}ms`);
  
  // CI verdict
  console.log('\n' + '═'.repeat(80));
  if (summary.ciPassed) {
    console.log('✅ CI CHECK PASSED - Safe to deploy');
  } else {
    console.log('❌ CI CHECK FAILED - DO NOT DEPLOY');
    if (summary.passRate < EVAL_CONFIG.ciThreshold) {
      console.log(`   ↳ Pass rate ${(summary.passRate * 100).toFixed(1)}% below threshold ${EVAL_CONFIG.ciThreshold * 100}%`);
    }
    if (summary.averageScore < EVAL_CONFIG.minAverageScore) {
      console.log(`   ↳ Average score ${summary.averageScore.toFixed(2)} below threshold ${EVAL_CONFIG.minAverageScore}`);
    }
    if (summary.criticalPassRate < 0.9) {
      console.log(`   ↳ Critical test pass rate ${(summary.criticalPassRate * 100).toFixed(1)}% below 90%`);
    }
  }
  console.log('═'.repeat(80) + '\n');
}

/**
 * Main evaluation runner
 */
async function main(): Promise<void> {
  console.log('\n🚀 Starting OpenAI Evals for CRO Analyst...\n');
  
  // Validate OpenAI key
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY is required for model-graded evaluation');
    process.exit(1);
  }
  
  // Load test cases
  const testCases = loadTestCases();
  console.log(`📋 Loaded ${testCases.length} test cases from dataset\n`);
  
  // Run evaluations
  const results: EvalResult[] = [];
  
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    process.stdout.write(`Running ${i + 1}/${testCases.length}: ${testCase.input.slice(0, 40)}...`);
    
    const result = await runSingleEval(testCase, i + 1);
    results.push(result);
    
    const icon = result.graderPassed ? '✅' : (result.error ? '❌' : '⚠️');
    console.log(` ${icon}`);
    
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }
  
  // Calculate summary
  const summary = calculateSummary(results);
  
  // Print results
  printResults(results, summary);
  
  // Save detailed results
  const outputPath = path.join(__dirname, '../eval-results.json');
  fs.writeFileSync(outputPath, JSON.stringify({ results, summary }, null, 2));
  console.log(`📁 Detailed results saved to ${outputPath}\n`);
  
  // CI mode - exit with error code if threshold not met
  if (CI_MODE && !summary.ciPassed) {
    console.error('💀 Exiting with code 1 due to CI threshold breach\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
