import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { auth, googleProvider } from '../firebase'
import { AuthContext } from './authContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })
    return unsubscribe
  }, [])

  const signIn = async () => {
    await signInWithPopup(auth, googleProvider)
  }

  const signInWithEmail = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password)
  }

  const signUpWithEmail = async (email: string, password: string) => {
    await createUserWithEmailAndPassword(auth, email, password)
  }

  const signOut = async () => {
    await firebaseSignOut(auth)
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signInWithEmail, signUpWithEmail, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
