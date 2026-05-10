import { Capacitor } from '@capacitor/core'
import {
  signInWithPopup,
  signInWithRedirect,
  signInWithCredential,
  GoogleAuthProvider,
  OAuthProvider,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import type { UserCredential } from 'firebase/auth'
import { auth, googleProvider } from '../firebase'

// Lazy: keeps @capacitor-firebase/authentication out of the web bundle.
async function getNativeAuth() {
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication')
  return FirebaseAuthentication
}

// Mobile browsers (especially iOS Safari and Chrome with strict cookie
// policies / Storage Partitioning) increasingly block the
// signInWithPopup → cross-frame postMessage handoff that Firebase Auth
// uses. Symptom: tap "Sign in with Google" → popup opens, completes the
// Google flow, but the parent never receives the credential. UA-detect to
// route mobile through signInWithRedirect, which uses a top-level
// navigation and doesn't depend on third-party cookies.
function isMobileWebUA(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

export async function signInWithGoogle(): Promise<UserCredential> {
  if (!Capacitor.isNativePlatform()) {
    if (isMobileWebUA()) {
      // signInWithRedirect navigates the page; this promise never resolves.
      // The redirect lands back at the app and onAuthStateChanged fires
      // with the new user. getRedirectResult in AuthContext catches errors.
      await signInWithRedirect(auth, googleProvider)
      return new Promise<UserCredential>(() => {})
    }
    try {
      return await signInWithPopup(auth, googleProvider)
    } catch (err) {
      const code = (err as { code?: string } | null)?.code
      // Popup blocked / 3p cookies restricted → fall back to redirect.
      if (code === 'auth/popup-blocked' ||
          code === 'auth/popup-closed-by-user' ||
          code === 'auth/cancelled-popup-request' ||
          code === 'auth/web-storage-unsupported' ||
          code === 'auth/operation-not-supported-in-this-environment') {
        await signInWithRedirect(auth, googleProvider)
        return new Promise<UserCredential>(() => {})
      }
      throw err
    }
  }
  const result = await (await getNativeAuth()).signInWithGoogle()
  const idToken = result.credential?.idToken
  if (!idToken) throw new Error('Google sign-in returned no idToken')
  return signInWithCredential(auth, GoogleAuthProvider.credential(idToken))
}

export async function signInWithApple(): Promise<UserCredential> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Apple Sign-In is only available on native platforms')
  }
  const result = await (await getNativeAuth()).signInWithApple()
  const idToken = result.credential?.idToken
  if (!idToken) throw new Error('Apple sign-in returned no idToken')
  const provider = new OAuthProvider('apple.com')
  const credential = provider.credential({
    idToken,
    rawNonce: result.credential?.nonce,
  })
  return signInWithCredential(auth, credential)
}

export async function signOutEverywhere(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await (await getNativeAuth()).signOut()
  }
  await firebaseSignOut(auth)
}
