// Side-effect import: must run before any module that calls getFirestore() /
// getAuth(). Importing `./shared/init` first guarantees initializeApp() has
// been invoked by the time the handler modules below are evaluated.
import './shared/init.js'

export { chat } from './chat.js'
export { realtimeTokenApi } from './realtime.js'
export { soundscapeApi } from './soundscapeApi.js'
export { accountApi } from './account.js'
export { adminApi } from './admin/index.js'
export { mcpApi } from './mcp.js'
