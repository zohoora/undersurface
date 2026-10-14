import { getSettings } from '../store/settings'

// Pre-render banner for storage/auth failures (IndexedDB backing store lost).
// It can appear before React mounts, so it cannot use the i18n hook, and the
// active locale chunk may not have loaded yet; a tiny inline map keeps it in
// the writer's language regardless. Colors come from the theme's CSS
// variables (with neutral fallbacks for a not-yet-styled document).

const BANNER_ID = 'idb-lost-banner'

const COPY: Record<string, { message: string; action: string }> = {
  en: { message: 'Connection interrupted.', action: 'Refresh the page' },
  de: { message: 'Verbindung unterbrochen.', action: 'Seite neu laden' },
  es: { message: 'Conexión interrumpida.', action: 'Recargar la página' },
  fr: { message: 'Connexion interrompue.', action: 'Recharger la page' },
  hi: { message: 'कनेक्शन बाधित हुआ।', action: 'पेज रीफ़्रेश करें' },
  id: { message: 'Koneksi terputus.', action: 'Muat ulang halaman' },
  it: { message: 'Connessione interrotta.', action: 'Ricarica la pagina' },
  ja: { message: '接続が中断されました。', action: 'ページを再読み込み' },
  ko: { message: '연결이 끊어졌습니다.', action: '페이지 새로고침' },
  nl: { message: 'Verbinding onderbroken.', action: 'Pagina vernieuwen' },
  pl: { message: 'Połączenie zostało przerwane.', action: 'Odśwież stronę' },
  pt: { message: 'Conexão interrompida.', action: 'Recarregar a página' },
  ru: { message: 'Соединение прервано.', action: 'Обновить страницу' },
  th: { message: 'การเชื่อมต่อขัดข้อง', action: 'รีเฟรชหน้า' },
  tr: { message: 'Bağlantı kesildi.', action: 'Sayfayı yenile' },
  vi: { message: 'Kết nối bị gián đoạn.', action: 'Tải lại trang' },
  zh: { message: '连接已中断。', action: '刷新页面' },
}

export function connectionBannerCopy(language?: string): { message: string; action: string } {
  let code = language
  if (!code) {
    try {
      code = getSettings().language
    } catch {
      code = 'en'
    }
  }
  const base = (code ?? 'en').toLowerCase().split('-')[0]
  return COPY[base] ?? COPY.en
}

export function showConnectionBanner(): void {
  if (document.getElementById(BANNER_ID)) return
  const copy = connectionBannerCopy()
  const banner = document.createElement('div')
  banner.id = BANNER_ID
  banner.setAttribute('role', 'alert')
  Object.assign(banner.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    zIndex: '99999',
    padding: '14px 16px',
    background: 'var(--bg-primary, #1a1a1a)',
    color: 'var(--text-primary, #f4f0e8)',
    borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
    fontFamily: "'Inter', sans-serif",
    fontSize: '14px',
    textAlign: 'center',
    boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
  })
  banner.appendChild(document.createTextNode(copy.message))
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = copy.action
  Object.assign(button.style, {
    background: 'none',
    border: '1px solid currentColor',
    color: 'inherit',
    borderRadius: '4px',
    padding: '4px 12px',
    marginLeft: '8px',
    minHeight: '32px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '13px',
  })
  button.addEventListener('click', () => window.location.reload())
  banner.appendChild(button)
  document.body.appendChild(banner)
}

export function removeConnectionBanner(): void {
  document.getElementById(BANNER_ID)?.remove()
}
