import type { Response } from 'express'
import type { Request } from 'firebase-functions/v2/https'
import { onRequest } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { ALLOWED_ORIGINS } from '../shared/cors.js'
import { openAiKey } from '../shared/secrets.js'
import { verifyAdmin } from '../shared/auth.js'
import {
  handleGetConfig,
  handleGetOverview,
  handleGetSessionMessages,
  handleGetUserDetail,
  handleGetUserList,
  handleGenerateInsights,
  handleUpdateConfig,
} from './handlers.js'
import { computeAndCacheAnalytics, handleGetAnalytics } from './analytics.js'
import { ConfigValidationError } from './configSchema.js'

type AdminAction =
  | 'getOverview'
  | 'getUserList'
  | 'getUserDetail'
  | 'getConfig'
  | 'updateConfig'
  | 'getAnalytics'
  | 'refreshAnalytics'
  | 'generateInsights'
  | 'getSessionMessages'
  | 'getContactMessages'
  | 'getDiagnostics'

type AdminHandler = (
  adminEmail: string,
  params: Record<string, unknown>,
  res: Response,
) => Promise<void>

const ADMIN_HANDLERS: Record<AdminAction, AdminHandler> = {
  getOverview: async (_e, _p, res) => { res.json(await handleGetOverview()) },
  getUserList: async (_e, _p, res) => { res.json(await handleGetUserList()) },
  getUserDetail: async (_e, params, res) => {
    if (!params.uid || typeof params.uid !== 'string') {
      res.status(400).json({ error: 'Missing uid' })
      return
    }
    res.json(await handleGetUserDetail(params.uid))
  },
  getConfig: async (_e, _p, res) => { res.json(await handleGetConfig()) },
  updateConfig: async (adminEmail, params, res) => {
    if (!params.config) {
      res.status(400).json({ error: 'Missing config' })
      return
    }
    res.json(await handleUpdateConfig(params.config as Record<string, unknown>, adminEmail))
  },
  getAnalytics: async (_e, _p, res) => { res.json(await handleGetAnalytics()) },
  refreshAnalytics: async (_e, _p, res) => { res.json(await computeAndCacheAnalytics()) },
  generateInsights: async (_e, _p, res) => { res.json(await handleGenerateInsights(openAiKey.value())) },
  getSessionMessages: async (_e, params, res) => {
    if (!params.uid || !params.sessionId || typeof params.uid !== 'string' || typeof params.sessionId !== 'string') {
      res.status(400).json({ error: 'Missing uid or sessionId' })
      return
    }
    res.json(await handleGetSessionMessages(params.uid, params.sessionId))
  },
  getContactMessages: async (_e, _p, res) => {
    const snap = await getFirestore()
      .collection('contactMessages')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get()
    const messages = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    res.json({ messages })
  },
  getDiagnostics: async (_e, params, res) => {
    if (!params.uid || typeof params.uid !== 'string') {
      res.status(400).json({ error: 'Missing uid' })
      return
    }
    const limit = Math.min(Math.max(Number(params.limit) || 100, 1), 500)
    const snap = await getFirestore()
      .collection('users').doc(params.uid).collection('diagnostics')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get()
    const events = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    res.json({ events })
  },
}

export const adminApi = onRequest(
  {
    secrets: [openAiKey],
    cors: ALLOWED_ORIGINS,
    memory: '512MiB',
    timeoutSeconds: 120,
    region: 'us-central1',
  },
  async (req: Request, res: Response) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    const adminEmail = await verifyAdmin(req.headers.authorization)
    if (!adminEmail) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    if (!req.body || typeof req.body.action !== 'string') {
      res.status(400).json({ error: 'Missing action' })
      return
    }

    const { action, ...params } = req.body
    const handler = ADMIN_HANDLERS[action as AdminAction]
    if (!handler) {
      res.status(400).json({ error: `Unknown action: ${action}` })
      return
    }

    try {
      await handler(adminEmail, params, res)
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        res.status(400).json({ error: error.message })
        return
      }
      console.error('Admin API error:', error)
      res.status(500).json({ error: 'Internal error' })
    }
  },
)
