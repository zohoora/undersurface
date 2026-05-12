// Pinned to a specific snapshot rather than a "latest" alias so behavior doesn't
// drift when OpenAI rotates. Used by both /api/chat (live therapist/journal
// turns) and the admin insights handler (offline analysis).
export const OPENAI_CHAT_MODEL = 'gpt-5.5'
