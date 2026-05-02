import { Capacitor } from '@capacitor/core'
import {
  signInWithPopup,
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

export async function signInWithGoogle(): Promise<UserCredential> {
  if (!Capacitor.isNativePlatform()) {
    return signInWithPopup(auth, googleProvider)
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
