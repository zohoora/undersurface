import { useState } from 'react'
import type { GlobalConfig } from './adminTypes'
import { useAdminConfig } from './useAdminConfig'

const DEFAULTS: GlobalConfig = {
  defaultResponseSpeed: 1.0,
  features: {
    partsEnabled: true,
    visualEffectsEnabled: true,
    autocorrectEnabled: true,
    timeAwareAtmosphere: false,
    seasonalShifts: false,
    flowStateVisuals: false,
    handwritingMode: false,
    partsQuoting: false,
    partsDisagreeing: false,
    partQuietReturn: false,
    partCatchphrases: false,
    silenceAsResponse: false,
    quietOneEnabled: false,
    bodyMap: false,
    bilateralStimulation: false,
    echoes: false,
    innerWeather: false,
    lettersFromParts: false,
    ritualsNotStreaks: false,
    unfinishedThreads: false,
    emergencyGrounding: false,
    ruptureRepair: false,
    ruminationPivot: false,
    webcamHrv: false,
    polarH10: false,
    voiceEnabled: false,
    relaxEnabled: false,
    customSoundscapesEnabled: false,
  },
  atmosphere: {
    timeShiftIntensity: 0.3,
    seasonalIntensity: 0.3,
    seasonOverride: 'auto',
    flowThresholdSeconds: 60,
    flowGlowIntensity: 0.5,
    handwritingFont: 'Caveat',
    handwritingEffectBoost: 1.5,
  },
  partIntelligence: {
    quoteMinAge: 3,
    quoteChance: 0.15,
    disagreeChance: 0.1,
    disagreeMinParts: 3,
    quietThresholdDays: 5,
    returnBonusMultiplier: 2.0,
    catchphraseMaxPerPart: 3,
    silenceFlowThreshold: 120,
    silenceChance: 0.2,
  },
  engagement: {
    echoMaxAge: 90,
    echoChance: 0.1,
    echoMaxPerSession: 3,
    weatherUpdateInterval: 5,
    letterTriggerEntries: 10,
    letterMinParts: 2,
    ritualDetectionWindow: 14,
    threadMaxAge: 30,
    threadChance: 0.15,
  },
  grounding: {
    autoExitMinutes: 5,
    selfRoleScoreBonus: 40,
    otherRolePenalty: 30,
    intensityThreshold: 3,
  },
  voice: {
    defaultVoice: 'marin',
  },
  announcement: null,
  updatedAt: 0,
  updatedBy: '',
}

export function AdminSettings() {
  const {
    config,
    setConfig,
    loading,
    saving,
    message,
    save: handleSave,
    signalUpdate: handleSignalUpdate,
    resetDefaults: handleResetDefaults,
    updateSection,
  } = useAdminConfig(DEFAULTS)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))

  if (loading) return <div style={{ fontSize: 13, color: '#A09A94', padding: 20 }}>Loading...</div>
  if (!config) return <div style={{ fontSize: 13, color: '#A09A94', padding: 20 }}>No config loaded</div>

  const setFeature = (key: string, value: unknown) => updateSection('features', key, value)
  const setAtmo = (key: string, value: unknown) => updateSection('atmosphere', key, value)
  const setPartInt = (key: string, value: unknown) => updateSection('partIntelligence', key, value)
  const setEngage = (key: string, value: unknown) => updateSection('engagement', key, value)
  const setGround = (key: string, value: unknown) => updateSection('grounding', key, value)
  const setVoice = (key: string, value: unknown) => updateSection('voice', key, value)

  const inputStyle = {
    padding: '8px 12px',
    fontSize: 13,
    border: '1px solid #E8E4DF',
    borderRadius: 6,
    fontFamily: "'Inter', sans-serif",
    color: '#2D2B29',
    width: '100%',
    boxSizing: 'border-box' as const,
    background: '#FFFFFF',
  }

  const labelStyle = {
    fontSize: 12,
    fontWeight: 500 as const,
    color: '#6B6560',
    marginBottom: 6,
    display: 'block' as const,
  }

  const sectionStyle = {
    background: '#FFFFFF',
    borderRadius: 8,
    padding: 24,
    border: '1px solid #E8E4DF',
    marginBottom: 20,
  }

  return (
    <div style={{ maxWidth: 600 }}>
      {message && (
        <div style={{
          padding: '10px 16px',
          marginBottom: 16,
          borderRadius: 6,
          fontSize: 13,
          background: message.type === 'success' ? '#F0FDF4' : '#FEF2F2',
          color: message.type === 'success' ? '#166534' : '#B91C1C',
          border: `1px solid ${message.type === 'success' ? '#BBF7D0' : '#FECACA'}`,
        }}>
          {message.text}
        </div>
      )}

      <div style={sectionStyle}>
        <h3 style={{ fontSize: 14, fontWeight: 500, marginTop: 0, marginBottom: 20 }}>Defaults</h3>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>
            Default Response Speed ({config.defaultResponseSpeed.toFixed(1)} —{' '}
            {config.defaultResponseSpeed <= 0.8 ? 'deliberate (medium reasoning)'
              : config.defaultResponseSpeed >= 1.5 ? 'snappy (no reasoning)'
              : 'balanced (low reasoning)'})
          </label>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={config.defaultResponseSpeed}
            onChange={(e) => setConfig({ ...config, defaultResponseSpeed: parseFloat(e.target.value) })}
            style={{ width: '100%' }}
          />
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
            Controls both how quickly parts trigger to respond and how much the LLM deliberates before streaming output. Affects therapist conversations, parts in the editor, and reply generation.
          </div>
        </div>

      </div>

      <div style={sectionStyle}>
        <h3 style={{ fontSize: 14, fontWeight: 500, marginTop: 0, marginBottom: 20 }}>Core Feature Flags</h3>

        <ToggleRow
          label="Parts (AI thoughts)"
          checked={config.features.partsEnabled}
          onChange={(v) => setFeature('partsEnabled', v)}
        />
        <ToggleRow
          label="Autocorrect"
          checked={config.features.autocorrectEnabled}
          onChange={(v) => setFeature('autocorrectEnabled', v)}
        />
      </div>

      {/* Visual Effects */}
      <CollapsibleSection
        title="Visual Effects"
        isExpanded={!!expanded.visualEffects}
        onToggle={() => toggle('visualEffects')}
        style={sectionStyle}
      >
        <ToggleRow
          label="Master Switch (all effects)"
          checked={config.features.visualEffectsEnabled}
          onChange={(v) => setFeature('visualEffectsEnabled', v)}
        />
        {config.features.visualEffectsEnabled && (
          <>
            <ToggleRow
              label="Paragraph Fade"
              checked={config.features.paragraphFade !== false}
              onChange={(v) => setFeature('paragraphFade', v)}
            />
            <ToggleRow
              label="Ink Weight"
              checked={config.features.inkWeight !== false}
              onChange={(v) => setFeature('inkWeight', v)}
            />
            <ToggleRow
              label="Breathing Background"
              checked={config.features.breathingBackground !== false}
              onChange={(v) => setFeature('breathingBackground', v)}
            />
          </>
        )}
      </CollapsibleSection>

      {/* Atmosphere Features */}
      <CollapsibleSection
        title="Atmosphere Features"
        isExpanded={!!expanded.atmosphere}
        onToggle={() => toggle('atmosphere')}
        style={sectionStyle}
      >
        <ToggleRow
          label="Time-Aware Atmosphere"
          checked={!!config.features.timeAwareAtmosphere}
          onChange={(v) => setFeature('timeAwareAtmosphere', v)}
        />
        {config.features.timeAwareAtmosphere && (
          <SliderRow
            label="Time Shift Intensity"
            value={config.atmosphere?.timeShiftIntensity ?? 0.3}
            min={0} max={1} step={0.05}
            onChange={(v) => setAtmo('timeShiftIntensity', v)}
          />
        )}

        <ToggleRow
          label="Seasonal Shifts"
          checked={!!config.features.seasonalShifts}
          onChange={(v) => setFeature('seasonalShifts', v)}
        />
        {config.features.seasonalShifts && (
          <>
            <SliderRow
              label="Seasonal Intensity"
              value={config.atmosphere?.seasonalIntensity ?? 0.3}
              min={0} max={1} step={0.05}
              onChange={(v) => setAtmo('seasonalIntensity', v)}
            />
            <div style={{ marginBottom: 12, marginTop: 4 }}>
              <label style={labelStyle}>Season Override</label>
              <select
                value={config.atmosphere?.seasonOverride ?? 'auto'}
                onChange={(e) => setAtmo('seasonOverride', e.target.value)}
                style={inputStyle}
              >
                <option value="auto">Auto (from date)</option>
                <option value="spring">Spring</option>
                <option value="summer">Summer</option>
                <option value="autumn">Autumn</option>
                <option value="winter">Winter</option>
              </select>
            </div>
          </>
        )}

        <ToggleRow
          label="Flow State Visuals"
          checked={!!config.features.flowStateVisuals}
          onChange={(v) => setFeature('flowStateVisuals', v)}
        />
        {config.features.flowStateVisuals && (
          <>
            <SliderRow
              label="Flow Threshold (sec)"
              value={config.atmosphere?.flowThresholdSeconds ?? 60}
              min={15} max={180} step={5}
              onChange={(v) => setAtmo('flowThresholdSeconds', v)}
            />
            <SliderRow
              label="Flow Glow Intensity"
              value={config.atmosphere?.flowGlowIntensity ?? 0.5}
              min={0} max={1} step={0.05}
              onChange={(v) => setAtmo('flowGlowIntensity', v)}
            />
          </>
        )}

        <ToggleRow
          label="Handwriting Mode"
          checked={!!config.features.handwritingMode}
          onChange={(v) => setFeature('handwritingMode', v)}
        />
        {config.features.handwritingMode && (
          <div style={{ marginBottom: 12, marginTop: 4 }}>
            <label style={labelStyle}>Handwriting Font</label>
            <input
              type="text"
              value={config.atmosphere?.handwritingFont ?? 'Caveat'}
              onChange={(e) => setAtmo('handwritingFont', e.target.value)}
              style={inputStyle}
            />
          </div>
        )}
      </CollapsibleSection>

      {/* Part Intelligence Features */}
      <CollapsibleSection
        title="Part Intelligence Features"
        isExpanded={!!expanded.partIntelligence}
        onToggle={() => toggle('partIntelligence')}
        style={sectionStyle}
      >
        <ToggleRow
          label="Parts Quoting the Writer"
          checked={!!config.features.partsQuoting}
          onChange={(v) => setFeature('partsQuoting', v)}
        />
        {config.features.partsQuoting && (
          <>
            <SliderRow
              label="Quote Chance"
              value={config.partIntelligence?.quoteChance ?? 0.15}
              min={0} max={0.5} step={0.01}
              onChange={(v) => setPartInt('quoteChance', v)}
            />
            <SliderRow
              label="Quote Min Age (days)"
              value={config.partIntelligence?.quoteMinAge ?? 3}
              min={1} max={30} step={1}
              onChange={(v) => setPartInt('quoteMinAge', v)}
            />
          </>
        )}

        <ToggleRow
          label="Parts Disagreeing"
          checked={!!config.features.partsDisagreeing}
          onChange={(v) => setFeature('partsDisagreeing', v)}
        />
        {config.features.partsDisagreeing && (
          <>
            <SliderRow
              label="Disagree Chance"
              value={config.partIntelligence?.disagreeChance ?? 0.1}
              min={0} max={0.3} step={0.01}
              onChange={(v) => setPartInt('disagreeChance', v)}
            />
            <SliderRow
              label="Min Active Parts"
              value={config.partIntelligence?.disagreeMinParts ?? 3}
              min={2} max={6} step={1}
              onChange={(v) => setPartInt('disagreeMinParts', v)}
            />
          </>
        )}

        <ToggleRow
          label="Part Quiet Return"
          checked={!!config.features.partQuietReturn}
          onChange={(v) => setFeature('partQuietReturn', v)}
        />
        {config.features.partQuietReturn && (
          <>
            <SliderRow
              label="Quiet Threshold (days)"
              value={config.partIntelligence?.quietThresholdDays ?? 5}
              min={1} max={30} step={1}
              onChange={(v) => setPartInt('quietThresholdDays', v)}
            />
            <SliderRow
              label="Return Bonus Multiplier"
              value={config.partIntelligence?.returnBonusMultiplier ?? 2.0}
              min={1} max={5} step={0.5}
              onChange={(v) => setPartInt('returnBonusMultiplier', v)}
            />
          </>
        )}

        <ToggleRow
          label="Part Catchphrases"
          checked={!!config.features.partCatchphrases}
          onChange={(v) => setFeature('partCatchphrases', v)}
        />
        {config.features.partCatchphrases && (
          <SliderRow
            label="Max Catchphrases Per Part"
            value={config.partIntelligence?.catchphraseMaxPerPart ?? 3}
            min={1} max={5} step={1}
            onChange={(v) => setPartInt('catchphraseMaxPerPart', v)}
          />
        )}

        <ToggleRow
          label="Silence as Response"
          checked={!!config.features.silenceAsResponse}
          onChange={(v) => setFeature('silenceAsResponse', v)}
        />
        {config.features.silenceAsResponse && (
          <>
            <SliderRow
              label="Silence Flow Threshold (sec)"
              value={config.partIntelligence?.silenceFlowThreshold ?? 120}
              min={30} max={300} step={10}
              onChange={(v) => setPartInt('silenceFlowThreshold', v)}
            />
            <SliderRow
              label="Silence Chance"
              value={config.partIntelligence?.silenceChance ?? 0.2}
              min={0} max={0.5} step={0.01}
              onChange={(v) => setPartInt('silenceChance', v)}
            />
          </>
        )}

        <ToggleRow
          label="The Quiet One"
          checked={!!config.features.quietOneEnabled}
          onChange={(v) => setFeature('quietOneEnabled', v)}
        />
        <ToggleRow
          label="Body Map"
          checked={!!config.features.bodyMap}
          onChange={(v) => setFeature('bodyMap', v)}
        />
        <ToggleRow
          label="Bilateral Stimulation"
          checked={!!config.features.bilateralStimulation}
          onChange={(v) => setFeature('bilateralStimulation', v)}
        />
      </CollapsibleSection>

      {/* Engagement Features */}
      <CollapsibleSection
        title="Engagement Features"
        isExpanded={!!expanded.engagement}
        onToggle={() => toggle('engagement')}
        style={sectionStyle}
      >
        <ToggleRow
          label="Echoes (Past Entry Fragments)"
          checked={!!config.features.echoes}
          onChange={(v) => setFeature('echoes', v)}
        />
        {config.features.echoes && (
          <>
            <SliderRow
              label="Echo Chance"
              value={config.engagement?.echoChance ?? 0.1}
              min={0} max={0.3} step={0.01}
              onChange={(v) => setEngage('echoChance', v)}
            />
            <SliderRow
              label="Echo Max Age (days)"
              value={config.engagement?.echoMaxAge ?? 90}
              min={7} max={365} step={7}
              onChange={(v) => setEngage('echoMaxAge', v)}
            />
            <SliderRow
              label="Max Echoes Per Session"
              value={config.engagement?.echoMaxPerSession ?? 3}
              min={1} max={10} step={1}
              onChange={(v) => setEngage('echoMaxPerSession', v)}
            />
          </>
        )}

        <ToggleRow
          label="Inner Weather"
          checked={!!config.features.innerWeather}
          onChange={(v) => setFeature('innerWeather', v)}
        />
        {config.features.innerWeather && (
          <SliderRow
            label="Weather Update Interval (min)"
            value={config.engagement?.weatherUpdateInterval ?? 5}
            min={1} max={15} step={1}
            onChange={(v) => setEngage('weatherUpdateInterval', v)}
          />
        )}

        <ToggleRow
          label="Letters from Parts"
          checked={!!config.features.lettersFromParts}
          onChange={(v) => setFeature('lettersFromParts', v)}
        />
        {config.features.lettersFromParts && (
          <>
            <SliderRow
              label="Letter Trigger Entries"
              value={config.engagement?.letterTriggerEntries ?? 10}
              min={3} max={30} step={1}
              onChange={(v) => setEngage('letterTriggerEntries', v)}
            />
            <SliderRow
              label="Min Parts in Letter"
              value={config.engagement?.letterMinParts ?? 2}
              min={1} max={6} step={1}
              onChange={(v) => setEngage('letterMinParts', v)}
            />
          </>
        )}

        <ToggleRow
          label="Rituals Not Streaks"
          checked={!!config.features.ritualsNotStreaks}
          onChange={(v) => setFeature('ritualsNotStreaks', v)}
        />
        {config.features.ritualsNotStreaks && (
          <SliderRow
            label="Ritual Detection Window (days)"
            value={config.engagement?.ritualDetectionWindow ?? 14}
            min={7} max={60} step={1}
            onChange={(v) => setEngage('ritualDetectionWindow', v)}
          />
        )}

        <ToggleRow
          label="Unfinished Threads"
          checked={!!config.features.unfinishedThreads}
          onChange={(v) => setFeature('unfinishedThreads', v)}
        />
        {config.features.unfinishedThreads && (
          <>
            <SliderRow
              label="Thread Max Age (days)"
              value={config.engagement?.threadMaxAge ?? 30}
              min={3} max={90} step={1}
              onChange={(v) => setEngage('threadMaxAge', v)}
            />
            <SliderRow
              label="Thread Chance"
              value={config.engagement?.threadChance ?? 0.15}
              min={0} max={0.5} step={0.01}
              onChange={(v) => setEngage('threadChance', v)}
            />
          </>
        )}
      </CollapsibleSection>

      {/* Safety & Wellbeing */}
      <CollapsibleSection
        title="Safety & Wellbeing"
        isExpanded={!!expanded.safety}
        onToggle={() => toggle('safety')}
        style={sectionStyle}
      >
        <ToggleRow
          label="Emergency Grounding"
          checked={!!config.features.emergencyGrounding}
          onChange={(v) => setFeature('emergencyGrounding', v)}
        />
        {config.features.emergencyGrounding && (
          <>
            <SliderRow
              label="Auto-Exit Timeout (min)"
              value={config.grounding?.autoExitMinutes ?? 5}
              min={1} max={15} step={1}
              onChange={(v) => setGround('autoExitMinutes', v)}
            />
            <SliderRow
              label="Self-Role Score Bonus"
              value={config.grounding?.selfRoleScoreBonus ?? 40}
              min={10} max={80} step={5}
              onChange={(v) => setGround('selfRoleScoreBonus', v)}
            />
            <SliderRow
              label="Other Role Penalty"
              value={config.grounding?.otherRolePenalty ?? 30}
              min={10} max={60} step={5}
              onChange={(v) => setGround('otherRolePenalty', v)}
            />
            <SliderRow
              label="Intensity Threshold"
              value={config.grounding?.intensityThreshold ?? 3}
              min={1} max={8} step={1}
              onChange={(v) => setGround('intensityThreshold', v)}
            />
          </>
        )}
        <ToggleRow
          label="Rupture Repair (opener acknowledgment)"
          checked={!!config.features.ruptureRepair}
          onChange={(v) => setFeature('ruptureRepair', v)}
        />
        <ToggleRow
          label="Rumination Pivot (silent register shift)"
          checked={!!config.features.ruminationPivot}
          onChange={(v) => setFeature('ruminationPivot', v)}
        />
      </CollapsibleSection>

      {/* Biometric */}
      <CollapsibleSection
        title="Biometric"
        isExpanded={!!expanded.biometric}
        onToggle={() => toggle('biometric')}
        style={sectionStyle}
      >
        <ToggleRow
          label="Webcam HRV (Session Mode)"
          checked={!!config.features.webcamHrv}
          onChange={(v) => setFeature('webcamHrv', v)}
        />
        <ToggleRow
          label="Polar H10 BLE (Session Mode)"
          checked={!!config.features.polarH10}
          onChange={(v) => setFeature('polarH10', v)}
        />
        <div style={{ fontSize: 11, color: '#A09A94', marginTop: 8, lineHeight: 1.5 }}>
          When a Polar H10 (or any standard Bluetooth heart-rate monitor) is paired,
          it replaces the webcam HRV path. Web Bluetooth only — Chrome desktop &amp;
          Android, Edge, Opera. Safari and iOS browsers hide the connect button.
        </div>
      </CollapsibleSection>

      {/* Relax Mode (4th session surface) */}
      <CollapsibleSection
        title="Relax Mode"
        isExpanded={!!expanded.relax}
        onToggle={() => toggle('relax')}
        style={sectionStyle}
      >
        <ToggleRow
          label="Enable Relax Mode (Session)"
          checked={!!config.features.relaxEnabled}
          onChange={(v) => setFeature('relaxEnabled', v)}
        />
        <div style={{ fontSize: 11, color: '#A09A94', marginTop: 12, lineHeight: 1.5 }}>
          A meditation/biofeedback/hypnotherapy surface inside Sessions. Adapts to webcam HRV when available; works without it. Background audio + voice guidance are user-toggleable per session.
        </div>

        {config.features.relaxEnabled && (
          <>
            <div style={{ marginTop: 16 }}>
              <ToggleRow
                label="Custom soundscapes (Relax)"
                checked={!!config.features.customSoundscapesEnabled}
                onChange={(v) => setFeature('customSoundscapesEnabled', v)}
              />
            </div>
            <div style={{ fontSize: 11, color: '#A09A94', marginTop: 12, lineHeight: 1.5 }}>
              Lets users describe a soundscape (e.g. "rain on a tin roof") and the system generates a 30s loop via ElevenLabs Sound Effects. Cached globally by content hash. Per-user limits: 5 generations / hour, 60 requests / hour.
            </div>
          </>
        )}
      </CollapsibleSection>

      {/* Voice Mode (Conversation / Therapist only) */}
      <CollapsibleSection
        title="Voice Mode"
        isExpanded={!!expanded.voice}
        onToggle={() => toggle('voice')}
        style={sectionStyle}
      >
        <ToggleRow
          label="Enable Voice Conversation"
          checked={!!config.features.voiceEnabled}
          onChange={(v) => setFeature('voiceEnabled', v)}
        />
        {config.features.voiceEnabled && (
          <>
            <div style={{ marginTop: 16, marginBottom: 0 }}>
              <label style={labelStyle}>Default Voice (OpenAI Realtime)</label>
              <select
                value={config.voice?.defaultVoice ?? 'marin'}
                onChange={(e) => setVoice('defaultVoice', e.target.value)}
                style={inputStyle}
              >
                <option value="marin">Marin (warm, recommended)</option>
                <option value="cedar">Cedar (grounded, recommended)</option>
                <option value="alloy">Alloy</option>
                <option value="ash">Ash</option>
                <option value="ballad">Ballad</option>
                <option value="coral">Coral</option>
                <option value="echo">Echo</option>
                <option value="sage">Sage</option>
                <option value="shimmer">Shimmer</option>
                <option value="verse">Verse</option>
              </select>
            </div>
            <div style={{ fontSize: 11, color: '#A09A94', marginTop: 12, lineHeight: 1.5 }}>
              Conversation (therapist) mode only. Uses OpenAI gpt-realtime via WebRTC. Locks voice sessions to OpenAI's model regardless of the default model above.
            </div>
          </>
        )}
      </CollapsibleSection>

      <div style={sectionStyle}>
        <h3 style={{ fontSize: 14, fontWeight: 500, marginTop: 0, marginBottom: 20 }}>Announcement</h3>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Message (empty = no announcement)</label>
          <textarea
            value={config.announcement?.message ?? ''}
            onChange={(e) => {
              if (!e.target.value) {
                setConfig({ ...config, announcement: null })
              } else {
                setConfig({
                  ...config,
                  announcement: {
                    message: e.target.value,
                    type: config.announcement?.type ?? 'info',
                    dismissible: config.announcement?.dismissible ?? true,
                  },
                })
              }
            }}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>

        {config.announcement && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Type</label>
              <select
                value={config.announcement.type}
                onChange={(e) => setConfig({
                  ...config,
                  announcement: { ...config.announcement!, type: e.target.value as 'info' | 'warning' },
                })}
                style={inputStyle}
              >
                <option value="info">Info</option>
                <option value="warning">Warning</option>
              </select>
            </div>

            <ToggleRow
              label="Dismissible"
              checked={config.announcement.dismissible}
              onChange={(v) => setConfig({
                ...config,
                announcement: { ...config.announcement!, dismissible: v },
              })}
            />
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '10px 32px',
            fontSize: 13,
            fontFamily: "'Inter', sans-serif",
            background: saving ? '#E8E4DF' : '#2D2B29',
            color: saving ? '#A09A94' : '#FFFFFF',
            border: 'none',
            borderRadius: 6,
            cursor: saving ? 'default' : 'pointer',
          }}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
        <button
          onClick={handleSignalUpdate}
          disabled={saving}
          style={{
            padding: '10px 24px',
            fontSize: 13,
            fontFamily: "'Inter', sans-serif",
            background: 'none',
            color: saving ? '#A09A94' : '#6B6560',
            border: '1px solid #E8E4DF',
            borderRadius: 6,
            cursor: saving ? 'default' : 'pointer',
          }}
        >
          Signal Update
        </button>
        <button
          onClick={handleResetDefaults}
          disabled={saving}
          style={{
            padding: '10px 24px',
            fontSize: 13,
            fontFamily: "'Inter', sans-serif",
            background: 'none',
            color: saving ? '#A09A94' : '#B91C1C',
            border: '1px solid #FECACA',
            borderRadius: 6,
            cursor: saving ? 'default' : 'pointer',
          }}
        >
          Reset Defaults
        </button>
      </div>
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 0',
      fontSize: 13,
      cursor: 'pointer',
    }}>
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 16, height: 16, cursor: 'pointer' }}
      />
    </label>
  )
}

function SliderRow({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '4px 0 4px 16px',
      fontSize: 12,
      color: '#6B6560',
    }}>
      <span>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ width: 80 }}
        />
        <span style={{ fontSize: 11, minWidth: 32, textAlign: 'right', color: '#A09A94' }}>
          {value}
        </span>
      </div>
    </div>
  )
}

function CollapsibleSection({ title, isExpanded, onToggle, style, children }: {
  title: string; isExpanded: boolean; onToggle: () => void
  style: React.CSSProperties; children: React.ReactNode
}) {
  return (
    <div style={style}>
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          border: 'none',
          background: 'none',
          padding: 0,
          marginBottom: isExpanded ? 16 : 0,
          cursor: 'pointer',
          fontFamily: "'Inter', sans-serif",
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 500, margin: 0, color: '#2D2B29' }}>{title}</h3>
        <span style={{ fontSize: 12, color: '#A09A94' }}>{isExpanded ? '−' : '+'}</span>
      </button>
      {isExpanded && children}
    </div>
  )
}
