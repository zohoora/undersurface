export const BASELINE_MODEL = 'google/gemini-3-flash-preview'

export const KNOWN_GOOD_PROVIDERS = [
  'google', 'anthropic', 'meta-llama', 'mistralai',
  'deepseek', 'cohere', 'qwen',
]

export const DEFAULT_WEIGHTS = { speed: 0.30, quality: 0.50, cost: 0.20 }

export const QUALITY_WEIGHTS = {
  partThoughts: 0.40,
  emotionDetection: 0.15,
  reflection: 0.15,
  emergence: 0.10,
  growth: 0.10,
  explorations: 0.10,
}

export const MONTHLY_USAGE = [
  { pattern: 'Part Thoughts', calls: 900, inputTokens: 1150, outputTokens: 150 },
  { pattern: 'Emotion Detection', calls: 450, inputTokens: 240, outputTokens: 20 },
  { pattern: 'Reflection', calls: 60, inputTokens: 2100, outputTokens: 800 },
  { pattern: 'Emergence', calls: 15, inputTokens: 850, outputTokens: 150 },
  { pattern: 'Growth', calls: 6, inputTokens: 1100, outputTokens: 600 },
  { pattern: 'Explorations', calls: 30, inputTokens: 500, outputTokens: 300 },
  { pattern: 'Others', calls: 100, inputTokens: 900, outputTokens: 200 },
]

export const COST_TIERS = {
  cheap: { max: 0.50 },
  mid: { min: 0.50, max: 3.0 },
  premium: { min: 3.0, max: 15.0 },
}

export const HARD_FILTERS = {
  minContextLength: 4096,
  minCompletionTokens: 800,
  maxCompletionPrice: 15.0,
}

export const SPEED_PARAMS = {
  ttfbTarget: 2000,
  totalTarget: 6000,
  tpsTarget: 60,
  streamingWeight: 0.70,
  nonStreamingWeight: 0.30,
  streamSubWeights: { ttfb: 0.50, total: 0.30, tps: 0.20 },
}

export const MAX_MONTHLY_COST = 5.0

export const VALID_EMOTIONS = [
  'neutral', 'tender', 'anxious', 'angry', 'sad',
  'joyful', 'contemplative', 'fearful', 'hopeful', 'conflicted',
]

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

export const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://undersurface.me',
  'X-Title': 'UnderSurface Benchmark',
}
