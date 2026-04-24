import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  query, 
  where, 
  getDocs, 
  onSnapshot,
  updateDoc,
  addDoc,
  serverTimestamp,
  Timestamp,
  increment,
  writeBatch
} from 'firebase/firestore';
import firebaseConfig from './firebaseConfig';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();

export const signIn = () => signInWithPopup(auth, googleProvider);
export const logout = () => auth.signOut();

export type TournamentFormat = 'doubles' | 'singles';

export interface Tournament {
  id: string;
  name: string;
  code: string;
  ownerId: string;
  format?: TournamentFormat;
  status: 'setup' | 'active' | 'completed';
  createdAt: Timestamp;
}

export interface Player {
  id: string;
  name: string;
  points: number;
  gamesPlayed: number;
  wins: number;
  addedAt: Timestamp;
}

export interface Match {
  id: string;
  round: number;
  team1: string[]; // Player IDs
  team2: string[]; // Player IDs
  score1: number;
  score2: number;
  status: 'pending' | 'completed' | 'void';
  updatedAt: Timestamp;
  completedAt?: Timestamp | null;
  voidedAt?: Timestamp | null;
  statusBeforeVoid?: 'pending' | 'completed' | null;
  previousScore1?: number | null;
  previousScore2?: number | null;
  previousCompletedAt?: Timestamp | null;
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
  authInfo: {
    userId: string;
    email: string;
    emailVerified: boolean;
    isAnonymous: boolean;
    providerInfo: any[];
  }
}

export const handleFirestoreError = (error: any, operationType: string, path: string | null = null): never => {
  const user = auth.currentUser;
  const errorInfo: FirestoreErrorInfo = {
    error: error.message || 'Unknown Firestore error',
    operationType: operationType as any,
    path,
    authInfo: {
      userId: user?.uid || 'unauthenticated',
      email: user?.email || '',
      emailVerified: user?.emailVerified || false,
      isAnonymous: user?.isAnonymous || false,
      providerInfo: user?.providerData || []
    }
  };
  throw new Error(JSON.stringify(errorInfo));
};

export const getReadableFirestoreError = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error)) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(error.message) as FirestoreErrorInfo;
    if (parsed.error.includes('Missing or insufficient permissions')) {
      return 'You do not have access for that action yet. Join the tournament first, or ask the owner to try again.';
    }
    return parsed.error || fallback;
  } catch {
    if (error.message.includes('Missing or insufficient permissions')) {
      return 'You do not have access for that action yet. Join the tournament first, or ask the owner to try again.';
    }
    return error.message || fallback;
  }
};