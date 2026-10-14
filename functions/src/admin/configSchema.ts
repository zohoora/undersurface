type ConfigRecord = Record<string, unknown>

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigValidationError'
  }
}

const FEATURE_KEYS = new Set([
  'partsEnabled', 'visualEffectsEnabled', 'autocorrectEnabled',
  'timeAwareAtmosphere', 'seasonalShifts', 'flowStateVisuals', 'handwritingMode',
  'partsQuoting', 'partsDisagreeing', 'partQuietReturn', 'partCatchphrases',
  'silenceAsResponse', 'quietOneEnabled', 'bodyMap', 'bilateralStimulation',
  'echoes', 'innerWeather', 'lettersFromParts', 'ritualsNotStreaks',
  'unfinishedThreads', 'paragraphFade', 'inkWeight', 'breathingBackground',
  'emergencyGrounding', 'ruptureRepair', 'ruminationPivot', 'userParts',
  'sessionIntentions', 'stanceAdaptation', 'userValues', 'companionInteriority',
  'companionPresence', 'earnedHumor', 'storyArcs', 'webcamHrv', 'polarH10',
  'voiceEnabled', 'relaxEnabled', 'driftEnabled',
  // Room (replaced Relax/Drift 2026-07-11). Unset = derived from relax/drift;
  // see shared/featureFlags.ts isRoomEnabled.
  'roomEnabled',
  // SMS field channel kill switch. Enabled unless explicitly false.
  'smsEnabled',
])

// Feature keys that no longer control anything. An update that still carries
// one (a stale admin bundle, or a value round-tripped from the stored doc) is
// accepted and the key is dropped instead of failing the whole save.
// customSoundscapesEnabled gated soundscapeApi, removed 2026-10-14.
const RETIRED_FEATURE_KEYS: ReadonlySet<string> = new Set(['customSoundscapesEnabled'])

const NUMBER_SECTION_KEYS: Record<string, ReadonlySet<string>> = {
  atmosphere: new Set([
    'timeShiftIntensity', 'morningHue', 'afternoonHue', 'eveningHue', 'nightHue',
    'seasonalIntensity', 'flowThresholdSeconds', 'flowGlowIntensity',
    'handwritingEffectBoost',
  ]),
  partIntelligence: new Set([
    'quoteMinAge', 'quoteChance', 'disagreeChance', 'disagreeMinParts',
    'quietThresholdDays', 'returnBonusMultiplier', 'catchphraseMaxPerPart',
    'silenceFlowThreshold', 'silenceChance',
  ]),
  engagement: new Set([
    'echoMaxAge', 'echoChance', 'echoMaxPerSession', 'weatherUpdateInterval',
    'letterTriggerEntries', 'letterMinParts', 'ritualDetectionWindow',
    'threadMaxAge', 'threadChance',
  ]),
  grounding: new Set([
    'autoExitMinutes', 'selfRoleScoreBonus', 'otherRolePenalty', 'intensityThreshold',
  ]),
}

const SEASONS = new Set(['spring', 'summer', 'autumn', 'winter', 'auto'])
const VOICES = new Set([
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar',
])

function objectValue(value: unknown, path: string): ConfigRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigValidationError(`${path} must be an object`)
  }
  return value as ConfigRecord
}

function rejectUnknownKeys(value: ConfigRecord, allowed: ReadonlySet<string>, path: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.has(key))
  if (unknown.length > 0) {
    throw new ConfigValidationError(`Unsupported ${path} field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`)
  }
}

function validateFiniteNumbers(section: string, value: unknown): ConfigRecord {
  const record = objectValue(value, section)
  const allowed = NUMBER_SECTION_KEYS[section]
  rejectUnknownKeys(record, allowed, section)
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      throw new ConfigValidationError(`${section}.${key} must be a finite number`)
    }
  }
  return { ...record }
}

function validateFeatures(value: unknown): ConfigRecord {
  const raw = objectValue(value, 'features')
  const features: ConfigRecord = {}
  for (const [key, entry] of Object.entries(raw)) {
    if (!RETIRED_FEATURE_KEYS.has(key)) features[key] = entry
  }
  rejectUnknownKeys(features, FEATURE_KEYS, 'features')
  for (const [key, entry] of Object.entries(features)) {
    if (typeof entry !== 'boolean') {
      throw new ConfigValidationError(`features.${key} must be a boolean`)
    }
  }
  return features
}

function validateAtmosphere(value: unknown): ConfigRecord {
  const raw = objectValue(value, 'atmosphere')
  const allowed = new Set([
    ...NUMBER_SECTION_KEYS.atmosphere,
    'seasonOverride', 'handwritingFont',
  ])
  rejectUnknownKeys(raw, allowed, 'atmosphere')
  const atmosphere: ConfigRecord = {}
  for (const key of NUMBER_SECTION_KEYS.atmosphere) {
    const entry = raw[key]
    if (entry === undefined) continue
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      throw new ConfigValidationError(`atmosphere.${key} must be a finite number`)
    }
    atmosphere[key] = entry
  }
  if (raw.seasonOverride !== undefined && (typeof raw.seasonOverride !== 'string' || !SEASONS.has(raw.seasonOverride))) {
    throw new ConfigValidationError('atmosphere.seasonOverride is invalid')
  }
  if (raw.handwritingFont !== undefined && (typeof raw.handwritingFont !== 'string' || raw.handwritingFont.length > 80)) {
    throw new ConfigValidationError('atmosphere.handwritingFont must be a string of at most 80 characters')
  }
  return { ...atmosphere, ...(raw.seasonOverride !== undefined && { seasonOverride: raw.seasonOverride }), ...(raw.handwritingFont !== undefined && { handwritingFont: raw.handwritingFont }) }
}

function validateAnnouncement(value: unknown): ConfigRecord | null {
  if (value === null) return null
  const announcement = objectValue(value, 'announcement')
  rejectUnknownKeys(announcement, new Set(['message', 'type', 'dismissible']), 'announcement')
  if (typeof announcement.message !== 'string' || announcement.message.length > 1000) {
    throw new ConfigValidationError('announcement.message must be a string of at most 1000 characters')
  }
  if (announcement.type !== 'info' && announcement.type !== 'warning') {
    throw new ConfigValidationError('announcement.type must be info or warning')
  }
  if (typeof announcement.dismissible !== 'boolean') {
    throw new ConfigValidationError('announcement.dismissible must be a boolean')
  }
  return { ...announcement }
}

export function validateConfigUpdate(partial: ConfigRecord): ConfigRecord {
  const allowedTopLevel = new Set([
    'defaultResponseSpeed', 'features', 'atmosphere', 'partIntelligence',
    'engagement', 'grounding', 'voice', 'announcement', 'buildVersion',
    // Quota remains owned by its existing server path. It is accepted here so
    // current deployments remain compatible, but this remediation does not
    // alter its semantics.
    'quota',
  ])
  rejectUnknownKeys(partial, allowedTopLevel, 'config')
  if (Object.keys(partial).length === 0) {
    throw new ConfigValidationError('Config update must contain at least one field')
  }

  const result: ConfigRecord = {}
  for (const [key, value] of Object.entries(partial)) {
    switch (key) {
      case 'defaultResponseSpeed':
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.5 || value > 2) {
          throw new ConfigValidationError('defaultResponseSpeed must be between 0.5 and 2')
        }
        result[key] = value
        break
      case 'features': result[key] = validateFeatures(value); break
      case 'atmosphere': result[key] = validateAtmosphere(value); break
      case 'partIntelligence': result[key] = validateFiniteNumbers(key, value); break
      case 'engagement': result[key] = validateFiniteNumbers(key, value); break
      case 'grounding': result[key] = validateFiniteNumbers(key, value); break
      case 'voice': {
        const voice = objectValue(value, 'voice')
        rejectUnknownKeys(voice, new Set(['defaultVoice']), 'voice')
        if (voice.defaultVoice !== undefined && (typeof voice.defaultVoice !== 'string' || !VOICES.has(voice.defaultVoice))) {
          throw new ConfigValidationError('voice.defaultVoice is invalid')
        }
        result[key] = { ...voice }
        break
      }
      case 'announcement': result[key] = validateAnnouncement(value); break
      case 'buildVersion':
        if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
          throw new ConfigValidationError('buildVersion must be a non-empty string of at most 64 characters')
        }
        result[key] = value
        break
      case 'quota': result[key] = objectValue(value, 'quota'); break
    }
  }
  return result
}
