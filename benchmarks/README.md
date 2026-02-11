# UnderSurface LLM Benchmark

Standalone tool for evaluating OpenRouter models against UnderSurface's 10 LLM call patterns. Measures speed (streaming TTFB, tokens/sec), quality (automated JSON validation + LLM-as-judge), and cost (estimated monthly per user).

## Quick Start

```bash
cd benchmarks
npm install

# Dry run — show filtered candidates and cost estimate (free)
npx tsx src/index.ts --api-key $OPENROUTER_API_KEY --dry-run

# Full benchmark — ~15-20 min, ~$0.70-$1.50
npx tsx src/index.ts --api-key $OPENROUTER_API_KEY --verbose

# Test specific models only
npx tsx src/index.ts --api-key $OPENROUTER_API_KEY \
  --only-models google/gemini-2.5-flash-lite microsoft/phi-4 \
  --verbose
```

## CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--api-key <key>` | required | OpenRouter API key |
| `--max-candidates <n>` | 20 | Max models after pre-filter |
| `--timing-runs <n>` | 3 | Speed test iterations per model |
| `--judge-model <model>` | `anthropic/claude-sonnet-4` | LLM-as-judge model |
| `--weights <w>` | `speed=0.3,quality=0.5,cost=0.2` | Composite score weights |
| `--output-dir <dir>` | `benchmarks/results` | Where to save JSON + Markdown |
| `--verbose` | false | Detailed per-model logging |
| `--include-model <m...>` | — | Always include these models |
| `--only-models <m...>` | — | Skip pre-filter, test only these |
| `--skip-judge` | false | Skip LLM-as-judge (faster/cheaper) |
| `--dry-run` | false | Phase 1 only, no API spending |

## How It Works

### Phase 1: Pre-Filter (400+ → ~20 models)

Fetches the OpenRouter model catalog (free) and applies:

- **Hard filters**: text I/O, context >= 4096, max_completion_tokens >= 800, completion price <= $15/M
- **Soft scoring**: known-good provider bonus, cost-tier diversity (cheap/mid/premium)
- **Always includes**: current baseline (`google/gemini-3-flash-preview`) + any `--include-model`

### Phase 2: Deep Evaluation

**Speed** (per model, 3 runs, drop worst, average rest):
- Streaming: TTFB, total latency, tokens/sec (using Part Thought test case)
- Non-streaming: round-trip time (using Emotion Detection test case)
- Handles thinking models: detects `reasoning_content` API field and inline `<think>` tags

**Quality** (automated + LLM-as-judge):
- Emotion Detection (4 samples): exact match = 100, contains = 60, miss = 0
- JSON patterns (emergence, reflection, growth, explorations): schema completeness scoring
- Part Thoughts (2 samples): LLM-as-judge scores brevity, emotional fit, genuineness, voice match
- Thinking model support: strips `<think>...</think>` and `<reasoning>...</reasoning>` before scoring

**Cost**: estimated monthly per user from OpenRouter catalog pricing × app usage patterns.

### Composite Score

```
final = speed × 0.30 + quality × 0.50 + cost × 0.20
```

Quality weighted highest because a cheap fast model that gives bad responses defeats the purpose.

## Test Cases

All prompts extracted from the real codebase:

| Pattern | Test | Scoring |
|---------|------|---------|
| Part Thought — The Watcher | Protector voice, avoidance diary | LLM-as-judge (40% of quality) |
| Part Thought — The Tender | Exile voice, grief diary | LLM-as-judge |
| Emotion Detection × 4 | conflicted, angry, hopeful, contemplative | Exact match (15% of quality) |
| Emergence | Hypervigilance diary | JSON schema (10%) |
| Reflection | Full entry + thoughts | JSON schema (15%) |
| Growth | Part evolution | JSON schema (10%) |
| Explorations | Writing prompts | JSON array schema (10%) |

## Output

- **Terminal**: ranked table with letter grades (A+ through F)
- **JSON**: full raw data in `results/benchmark-{timestamp}.json`
- **Markdown**: formatted report in `results/benchmark-{timestamp}.md`

## Architecture

```
src/
  index.ts          # CLI entry point (commander)
  config.ts         # Weights, thresholds, usage estimates, valid emotions
  types.ts          # Shared TypeScript interfaces
  prefilter.ts      # Phase 1: fetch + filter OpenRouter catalog
  speedTest.ts      # Streaming SSE + non-streaming timing
  qualityTest.ts    # Automated scoring + LLM-as-judge
  costCalc.ts       # Monthly cost modeling from catalog pricing
  composite.ts      # Weighted scoring + letter grades
  reporter.ts       # Terminal table + Markdown + JSON output
  testCases.ts      # All prompts (from real app codebase)
  jsonExtractor.ts  # JSON extraction + thinking-token stripping
```

## Results (2026-02-11)

Top 10 from full evaluation of 50+ models:

| # | Model | Score | Speed | Quality | $/month |
|---|-------|-------|-------|---------|---------|
| 1 | microsoft/phi-4 | 95.2 | 90 B+ | 97 A+ | $0.12 |
| 2 | qwen/qwen-2.5-72b-instruct | 94.5 | 91 A- | 97 A | $0.26 |
| 3 | google/gemini-2.5-flash-lite | 93.9 | 88 B+ | 97 A+ | $0.23 |
| 4 | qwen/qwen3-30b-a3b-instruct-2507 | 93.4 | 85 B | 98 A+ | $0.19 |
| 5 | openai/gpt-4o-mini | 92.5 | 90 B+ | 94 A | $0.35 |
| 6 | google/gemini-2.0-flash-001 | 92.4 | 82 B- | 97 A+ | $0.23 |
| 7 | openai/gpt-4.1-nano | 91.8 | 90 A- | 91 A- | $0.23 |
| 8 | mistralai/mistral-small-3.2-24b | 91.6 | 78 C+ | 97 A+ | $0.12 |
| 9 | google/gemini-2.0-flash-lite-001 | 91.0 | 77 C+ | 97 A+ | $0.17 |
| 9 | qwen/qwen3-next-80b-a3b-instruct | 91.0 | 79 C+ | 98 A+ | $0.37 |

Current baseline `google/gemini-3-flash-preview` ranked #20 at 85.7 ($1.38/month) — 6-15x more expensive than top alternatives with equivalent quality.

### Models that failed quality (0 or near-0)

These models can't follow the app's structured output requirements:
- Reasoning/thinking models: deepseek-r1-distill-*, qwen3-32b (without instruct suffix), qwen3-14b
- Format-incompatible: openai/gpt-5-nano, deepseek-v3.2-speciale, stepfun/step-3.5-flash
- Chinese LLMs via OpenRouter: z-ai/glm-4.7*, minimax/minimax-m2*, moonshotai/kimi-k2.5
- Open-weight: nvidia/nemotron-3-nano, openai/gpt-oss-*

## Re-running

To re-evaluate after OpenRouter adds new models or pricing changes:

```bash
cd benchmarks

# Full auto-filter run
npx tsx src/index.ts --api-key $OPENROUTER_API_KEY --verbose

# Test specific new models
npx tsx src/index.ts --api-key $OPENROUTER_API_KEY \
  --only-models new-provider/new-model \
  --verbose

# Compare against current top performers
npx tsx src/index.ts --api-key $OPENROUTER_API_KEY \
  --only-models microsoft/phi-4 google/gemini-2.5-flash-lite qwen/qwen3-30b-a3b-instruct-2507 new-provider/new-model \
  --verbose
```

## Cost

- ~22 API calls per model × N models + 2 judge calls per model
- 20 models ≈ $0.70-$1.50 total
- Single model test ≈ $0.03-$0.05
- Dry run: free (only fetches model catalog)
