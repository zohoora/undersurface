import { useState, useEffect } from 'react'
import { deleteAccount } from '../api/accountApi'
import { clearSettings } from '../store/settings'
import { getAuth, signOut } from 'firebase/auth'

interface DeleteAccountModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function DeleteAccountModal({ isOpen, onClose }: DeleteAccountModalProps) {
  // Inner component unmounts when closed, so state resets on next open
  if (!isOpen) return null
  return <DeleteAccountModalContent onClose={onClose} />
}

function DeleteAccountModalContent({ onClose }: { onClose: () => void }) {
  const [confirmation, setConfirmation] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const canDelete = confirmation.toLowerCase() === 'delete'

  const handleDelete = async () => {
    if (!canDelete || deleting) return
    setDeleting(true)
    setError(null)
    try {
      await deleteAccount()
      clearSettings()
      await signOut(getAuth())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deletion failed')
      setDeleting(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--overlay-medium)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !deleting) onClose() }}
    >
      <div style={{
        width: '100%',
        maxWidth: 420,
        margin: 16,
        background: 'var(--bg-primary)',
        borderRadius: 12,
        border: '1px solid var(--border-subtle)',
        padding: '24px',
        fontFamily: "'Inter', sans-serif",
      }}>
        <div style={{
          fontSize: 16,
          fontWeight: 500,
          color: 'var(--text-primary)',
          marginBottom: 12,
        }}>
          Delete your account
        </div>

        <div style={{
          fontSize: 13,
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
          marginBottom: 16,
        }}>
          This will permanently delete all your data — diary entries, inner voices, memories,
          thoughts, and everything else. This cannot be undone.
        </div>

        <div style={{
          fontSize: 12,
          color: 'var(--text-ghost)',
          lineHeight: 1.5,
          marginBottom: 20,
          padding: '10px 12px',
          background: 'var(--overlay-subtle)',
          borderRadius: 6,
        }}>
          Save your writing first via <strong>Export all data</strong> in Settings.
        </div>

        <div style={{
          fontSize: 12,
          color: 'var(--text-secondary)',
          marginBottom: 8,
        }}>
          Type <strong>delete</strong> to confirm
        </div>

        <input
          type="text"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          disabled={deleting}
          placeholder="delete"
          autoComplete="off"
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            background: 'var(--surface-primary)',
            color: 'var(--text-primary)',
            outline: 'none',
            marginBottom: 16,
          }}
        />

        {error && (
          <div style={{
            fontSize: 12,
            color: 'var(--color-tender)',
            marginBottom: 12,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onClose}
            disabled={deleting}
            style={{
              flex: 1,
              padding: '8px 16px',
              fontSize: 13,
              fontFamily: "'Inter', sans-serif",
              color: 'var(--text-secondary)',
              background: 'none',
              border: '1px solid var(--border-subtle)',
              borderRadius: 6,
              cursor: deleting ? 'default' : 'pointer',
              opacity: deleting ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!canDelete || deleting}
            style={{
              flex: 1,
              padding: '8px 16px',
              fontSize: 13,
              fontFamily: "'Inter', sans-serif",
              fontWeight: 500,
              color: canDelete ? '#fff' : 'var(--text-ghost)',
              background: canDelete ? 'var(--color-tender)' : 'var(--border-light)',
              border: 'none',
              borderRadius: 6,
              cursor: canDelete && !deleting ? 'pointer' : 'default',
              opacity: deleting ? 0.6 : 1,
            }}
          >
            {deleting ? 'Deleting...' : 'Delete everything'}
          </button>
        </div>
      </div>
    </div>
  )
}
