import { useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { AdminOverview } from './AdminOverview'
import { AdminUsers } from './AdminUsers'
import { AdminAnalytics } from './AdminAnalytics'
import { AdminInsights } from './AdminInsights'
import { AdminSettings } from './AdminSettings'
import { AdminMessages } from './AdminMessages'

type Tab = 'overview' | 'users' | 'analytics' | 'messages' | 'insights' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'messages', label: 'Messages' },
  { id: 'insights', label: 'Insights' },
  { id: 'settings', label: 'Settings' },
]

export default function AdminDashboard() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  return (
    <div style={{
      minHeight: '100vh',
      background: '#FAF8F5',
      fontFamily: "'Inter', sans-serif",
      color: '#2D2B29',
    }}>
      <header style={{
        padding: '16px 32px',
        borderBottom: '1px solid #E8E4DF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: '#FFFFFF',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <a
            href="/"
            style={{
              fontSize: 13,
              color: '#A09A94',
              textDecoration: 'none',
              letterSpacing: '0.1em',
            }}
          >
            undersurface
          </a>
          <span style={{ fontSize: 12, color: '#C4BEB8' }}>/</span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Admin</span>
        </div>
        <div style={{ fontSize: 12, color: '#A09A94' }}>
          {user?.email}
        </div>
      </header>

      <nav style={{
        padding: '0 32px',
        borderBottom: '1px solid #E8E4DF',
        background: '#FFFFFF',
        display: 'flex',
        gap: 0,
      }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '12px 20px',
              fontSize: 13,
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #2D2B29' : '2px solid transparent',
              color: activeTab === tab.id ? '#2D2B29' : '#A09A94',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: activeTab === tab.id ? 500 : 400,
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
        {activeTab === 'overview' && <AdminOverview />}
        {activeTab === 'users' && <AdminUsers />}
        {activeTab === 'analytics' && <AdminAnalytics />}
        {activeTab === 'messages' && <AdminMessages />}
        {activeTab === 'insights' && <AdminInsights />}
        {activeTab === 'settings' && <AdminSettings />}
      </main>
    </div>
  )
}
