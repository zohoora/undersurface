import { createHash, randomBytes } from 'node:crypto'
import { getFirestore } from 'firebase-admin/firestore'
import { normalizePhone, TWILIO_PHONE_DISPLAY, TWILIO_PHONE_NUMBER } from './field.js'

const LINK_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const LINK_CODE_LENGTH = 6
const LINK_CODE_TTL_MS = 10 * 60_000

interface SmsSettingsDoc {
  phoneHash: string
  phoneLast4: string
  linkedAt: number
  enabled: boolean
}

interface SmsPhoneLinkDoc {
  uid: string
  phoneLast4: string
  linkedAt: number
  enabled: boolean
}

interface SmsLinkCodeDoc {
  uid: string
  createdAt: number
  expiresAt: number
}

export interface SmsStatus {
  linked: boolean
  phoneLast4?: string
  linkedAt?: number
  phoneNumber: string
  phoneNumberE164: string
}

export interface SmsLinkCodeResult {
  code: string
  expiresAt: number
  phoneNumber: string
  phoneNumberE164: string
}

export type LinkPhoneResult =
  | { ok: true; uid: string; phoneLast4: string }
  | { ok: false; reason: 'invalid' | 'expired' }

export function hashSmsValue(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function generateSmsLinkCode(bytes: Uint8Array = randomBytes(LINK_CODE_LENGTH)): string {
  let result = ''
  for (let i = 0; i < LINK_CODE_LENGTH; i++) {
    result += LINK_CODE_ALPHABET[bytes[i] % LINK_CODE_ALPHABET.length]
  }
  return result
}

function smsSettingsRef(uid: string) {
  return getFirestore().collection('users').doc(uid).collection('smsSettings').doc('current')
}

function phoneLinkRef(phoneHash: string) {
  return getFirestore().collection('smsPhoneLinks').doc(phoneHash)
}

export async function createSmsLinkCode(uid: string, now = Date.now()): Promise<SmsLinkCodeResult> {
  const db = getFirestore()
  const stale = await db.collection('smsLinkCodes').where('uid', '==', uid).limit(20).get()
  if (!stale.empty) {
    const batch = db.batch()
    stale.docs.forEach(doc => batch.delete(doc.ref))
    await batch.commit()
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateSmsLinkCode()
    const expiresAt = now + LINK_CODE_TTL_MS
    try {
      await db.collection('smsLinkCodes').doc(hashSmsValue(code)).create({
        uid,
        createdAt: now,
        expiresAt,
      } satisfies SmsLinkCodeDoc)
      return {
        code,
        expiresAt,
        phoneNumber: TWILIO_PHONE_DISPLAY,
        phoneNumberE164: TWILIO_PHONE_NUMBER,
      }
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
  throw new Error('Could not create SMS link code')
}

export async function getSmsStatus(uid: string): Promise<SmsStatus> {
  const snap = await smsSettingsRef(uid).get()
  if (!snap.exists) {
    return {
      linked: false,
      phoneNumber: TWILIO_PHONE_DISPLAY,
      phoneNumberE164: TWILIO_PHONE_NUMBER,
    }
  }
  const data = snap.data() as SmsSettingsDoc
  return {
    linked: data.enabled === true,
    phoneLast4: data.phoneLast4,
    linkedAt: data.linkedAt,
    phoneNumber: TWILIO_PHONE_DISPLAY,
    phoneNumberE164: TWILIO_PHONE_NUMBER,
  }
}

export async function getLinkedUid(phone: string): Promise<string | null> {
  const normalized = normalizePhone(phone)
  if (!normalized) return null
  const snap = await phoneLinkRef(hashSmsValue(normalized)).get()
  if (!snap.exists) return null
  const data = snap.data() as SmsPhoneLinkDoc
  return data.enabled === true && typeof data.uid === 'string' ? data.uid : null
}

export async function linkPhoneByCode(
  phone: string,
  code: string,
  now = Date.now(),
): Promise<LinkPhoneResult> {
  const normalized = normalizePhone(phone)
  if (!normalized) return { ok: false, reason: 'invalid' }

  const db = getFirestore()
  const codeRef = db.collection('smsLinkCodes').doc(hashSmsValue(code.toUpperCase()))
  const incomingPhoneHash = hashSmsValue(normalized)
  const incomingLinkRef = phoneLinkRef(incomingPhoneHash)

  return db.runTransaction(async transaction => {
    const codeSnap = await transaction.get(codeRef)
    if (!codeSnap.exists) return { ok: false, reason: 'invalid' } as const
    const codeData = codeSnap.data() as SmsLinkCodeDoc
    if (codeData.expiresAt < now) {
      transaction.delete(codeRef)
      return { ok: false, reason: 'expired' } as const
    }

    const targetSettingsRef = smsSettingsRef(codeData.uid)
    const [targetSettingsSnap, incomingLinkSnap] = await Promise.all([
      transaction.get(targetSettingsRef),
      transaction.get(incomingLinkRef),
    ])

    const targetSettings = targetSettingsSnap.exists
      ? targetSettingsSnap.data() as SmsSettingsDoc
      : null
    const incomingLink = incomingLinkSnap.exists
      ? incomingLinkSnap.data() as SmsPhoneLinkDoc
      : null

    if (targetSettings?.phoneHash && targetSettings.phoneHash !== incomingPhoneHash) {
      transaction.delete(phoneLinkRef(targetSettings.phoneHash))
    }
    if (incomingLink?.uid && incomingLink.uid !== codeData.uid) {
      transaction.delete(smsSettingsRef(incomingLink.uid))
    }

    const phoneLast4 = normalized.slice(-4)
    transaction.set(incomingLinkRef, {
      uid: codeData.uid,
      phoneLast4,
      linkedAt: now,
      enabled: true,
    } satisfies SmsPhoneLinkDoc)
    transaction.set(targetSettingsRef, {
      phoneHash: incomingPhoneHash,
      phoneLast4,
      linkedAt: now,
      enabled: true,
    } satisfies SmsSettingsDoc)
    transaction.delete(codeRef)

    return { ok: true, uid: codeData.uid, phoneLast4 } as const
  })
}

export async function unlinkSms(uid: string): Promise<void> {
  const db = getFirestore()
  const settingsRef = smsSettingsRef(uid)
  const [settingsSnap, codes] = await Promise.all([
    settingsRef.get(),
    db.collection('smsLinkCodes').where('uid', '==', uid).limit(20).get(),
  ])
  const batch = db.batch()
  if (settingsSnap.exists) {
    const settings = settingsSnap.data() as SmsSettingsDoc
    if (settings.phoneHash) batch.delete(phoneLinkRef(settings.phoneHash))
    batch.delete(settingsRef)
  }
  codes.docs.forEach(doc => batch.delete(doc.ref))
  await batch.commit()
}

export async function unlinkPhone(phone: string): Promise<string | null> {
  const normalized = normalizePhone(phone)
  if (!normalized) return null
  const ref = phoneLinkRef(hashSmsValue(normalized))
  const snap = await ref.get()
  if (!snap.exists) return null
  const data = snap.data() as SmsPhoneLinkDoc
  const batch = getFirestore().batch()
  batch.delete(ref)
  if (typeof data.uid === 'string') batch.delete(smsSettingsRef(data.uid))
  await batch.commit()
  return typeof data.uid === 'string' ? data.uid : null
}
