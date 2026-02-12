# OpenAI Evals for CRO Analyst

Model-graded evaluation system following the approach from:
[How I Use OpenAI Evals to Test GPT Prompts Before Shipping AI Features](https://nicolalazzari.ai/articles/how-i-use-openai-evals-to-test-gpt-prompts-before-shipping-ai-features)

## Overview

This evaluation suite tests the AI SQL generation capabilities of the CRO Analyst application using **model-graded evaluation** with GPT-4o as the grader.

## Files

- `cro_sql_dataset.jsonl` - Test cases in JSONL format (input/ideal pairs)
- `config.ts` - Evaluation configuration and grading prompts
- `run.ts` - Main evaluation runner

## Usage

```bash
# Run against local dev server (localhost:3000)
npm run eval

# Run against production
npm run eval:prod

# CI mode - exits with code 1 if below threshold
npm run eval:ci
```

## Test Categories

| Category | Description | Weight |
|----------|-------------|--------|
| `vertical` | Vertical filtering (Solar, Hearing Aids, etc.) | 1.5x |
| `geo` | Geographic filtering (UK, DK, DE, etc.) | 1.5x |
| `b2c_b2b` | B2C/B2B classification from testName | 2.0x |
| `regional` | Regional filtering (Americas, RoW) | 1.5x |
| `dates` | Date range queries | 1.0x |
| `winners` | Winner/loser analysis | 1.0x |
| `person` | Person-based queries (launchedBy) | 1.0x |
| `aggregation` | GROUP BY and aggregations | 0.8x |
| `complex` | Multi-criteria queries | 1.2x |
| `edge` | Edge cases | 0.5x |

## CI Thresholds

- **Pass Rate**: ≥ 85%
- **Average Score**: ≥ 7.0/10
- **Critical Tests**: ≥ 90% must pass

## Adding Test Cases

Add new cases to `cro_sql_dataset.jsonl`:

```json
{"input": "Your question here", "ideal": "Expected SQL behavior description", "category": "category_name", "critical": true}
```

## GitHub Actions Integration

Add to your workflow:

```yaml
- name: Run AI Evals
  run: npm run eval:ci
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    AI_INTERNAL_API_KEY: ${{ secrets.AI_INTERNAL_API_KEY }}
    AI_TEST_ENDPOINT: https://cro-analyst-v3.vercel.app/api/ai/query
```

## Interpreting Results

- ✅ **Passed**: Score ≥ 7/10, correct SQL logic
- ⚠️ **Warning**: Score < 7/10, issues detected
- ❌ **Error**: API call failed or no SQL generated
- 🔴 **Critical**: Test marked as critical for deployment
- ⚪ **Non-critical**: Test is informational
