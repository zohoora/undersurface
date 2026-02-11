export interface OpenRouterModel {
  id: string
  name: string
  description?: string
  context_length: number
  pricing: {
    prompt: string
    completion: string
  }
  top_provider?: {
    max_completion_tokens?: number
    is_moderated?: boolean
  }
  architecture?: {
    input_modalities?: string[]
    output_modalities?: string[]
    tokenizer?: string
  }
  per_request_limits?: Record<string, string>
}

export interface ModelCandidate {
  id: string
  name: string
  contextLength: number
  promptPrice: number
  completionPrice: number
  maxCompletionTokens: number
  provider: string
  priorityScore: number
  isBaseline: boolean
}

export interface SpeedResult {
  modelId: string
  streaming: {
    ttfbMs: number
    totalMs: number
    tokensPerSecond: number
  } | null
  nonStreaming: {
    totalMs: number
  } | null
  score: number
  error?: string
  supportsStreaming: boolean
}

export interface QualityResult {
  modelId: string
  scores: {
    partThoughts: number
    emotionDetection: number
    reflection: number
    emergence: number
    growth: number
    explorations: number
  }
  overall: number
  details: QualityDetail[]
  error?: string
}

export interface QualityDetail {
  testCase: string
  pattern: string
  response: string
  score: number
  judgeResponse?: string
  notes?: string
}

export interface CostResult {
  modelId: string
  monthlyCostPerUser: number
  breakdown: {
    pattern: string
    callsPerMonth: number
    inputTokens: number
    outputTokens: number
    monthlyCost: number
  }[]
  score: number
}

export interface CompositeScore {
  modelId: string
  modelName: string
  speed: number
  quality: number
  cost: number
  overall: number
  monthlyCost: number
  grade: string
  speedGrade: string
  qualityGrade: string
  costGrade: string
  isBaseline: boolean
  errors: string[]
}

export interface BenchmarkConfig {
  apiKey: string
  maxCandidates: number
  timingRuns: number
  judgeModel: string
  weights: { speed: number; quality: number; cost: number }
  outputDir: string
  verbose: boolean
  includeModels: string[]
  onlyModels: string[]
  skipJudge: boolean
  dryRun: boolean
  baselineModel: string
}

export interface BenchmarkResult {
  timestamp: string
  config: Omit<BenchmarkConfig, 'apiKey'>
  candidates: ModelCandidate[]
  results: CompositeScore[]
  speedResults: SpeedResult[]
  qualityResults: QualityResult[]
  costResults: CostResult[]
  errors: string[]
  duration: number
}

export interface TestCase {
  id: string
  name: string
  pattern: 'partThought' | 'emotionDetection' | 'emergence' | 'reflection' | 'growth' | 'explorations'
  messages: { role: 'system' | 'user'; content: string }[]
  maxTokens: number
  temperature: number
  stream: boolean
  expectedFormat: 'freetext' | 'single-word' | 'json'
  validationFn?: (response: string) => number
}

export interface JudgeEvaluation {
  brevity: number
  noFirstPerson: number
  emotionalFit: number
  genuineness: number
  writingGuidance: number
  voiceMatch: number
  overall: number
  reasoning: string
}

export type ProgressCallback = (message: string, detail?: string) => void
