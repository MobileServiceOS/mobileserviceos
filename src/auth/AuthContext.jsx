// src/auth/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut as fbSignOut,
  GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail,
} from 'firebase/auth';
import { auth } from '../services/firebase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,      setUser]      = useState(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      setUser(u);
      setAuthReady(true);
    });
    return unsub;
  }, []);

  const signIn = (email, pw) => signInWithEmailAndPassword(auth, email, pw);

  const signUp = (email, pw) => createUserWithEmailAndPassword(auth, email, pw);

  const signInGoogle = () => signInWithPopup(auth, new GoogleAuthProvider());

  const signOut = () => fbSignOut(auth);

  const resetPassword = email => sendPasswordResetEmail(auth, email);

  return (
    <AuthContext.Provider value={{ user, authReady, signIn, signUp, signInGoogle, signOut, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
