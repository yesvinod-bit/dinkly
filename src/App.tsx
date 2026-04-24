import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  limit,
  Timestamp
} from 'firebase/firestore';
import { auth, db, signIn, logout, Tournament, TournamentFormat, handleFirestoreError } from './lib/firebase';
import { DEFAULT_TOURNAMENT_FORMAT, generateCode, getTournamentFormat, getTournamentFormatTag } from './lib/tournamentLogic';
import { Trophy, Users, Plus, Hash, LogOut, ChevronRight, History, Calendar, Bell, X, Shield, Loader2, CheckSquare, Square, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Lazy load heavy components
const TournamentDashboard = lazy(() => import('./components/TournamentDashboard'));
const Gatekeeper = lazy(() => import('./components/Gatekeeper'));
const AdminPanel = lazy(() => import('./components/AdminPanel'));

const LoadingOverlay = () => (
  <div className="fixed inset-0 bg-lime-50/80 backdrop-blur-sm z-[200] flex flex-col items-center justify-center">
    <div className="bg-white p-8 rounded-3xl border-4 border-slate-900 shadow-[8px_8px_0px_0px_rgba(30,41,59,1)] flex flex-col items-center">
      <Loader2 className="w-12 h-12 text-lime-500 animate-spin mb-4" />
      <h2 className="text-xl font-black text-slate-800 uppercase italic tracking-tighter">Dinkly Loading...</h2>
    </div>
  </div>
);

interface HistoryItem {
  id: string;
  name: string;
  code: string;
  role: 'owner' | 'player';
  format?: TournamentFormat;
  joinedAt: any;
}

interface LoginEvent {
  id: string;
  uid: string;
  displayName: string;
  photoURL: string;
  email: string;
  loginMethod: 'google' | 'anonymous' | 'unknown';
  providerId: string;
  isAnonymous: boolean;
  timestamp: any;
}

const LOGIN_SESSION_PREFIX = 'dinkly:login-recorded:';

function getAuthErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: string }).code) : '';

  switch (code) {
    case 'auth/unauthorized-domain':
      return `Google sign-in is not enabled for ${window.location.host} yet. Add this host in Firebase Authentication > Settings > Authorized domains.`;
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in popup. Allow popups for this site and try again.';
    case 'auth/popup-closed-by-user':
      return 'The Google sign-in popup was closed before sign-in finished.';
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not enabled for this Firebase project.';
    case 'auth/auth-domain-config-required':
      return 'Firebase Authentication is missing a valid auth domain configuration.';
    default:
      return 'Google sign-in failed. Check Firebase Authentication settings and try again.';
  }
}

function getUserLabel(user: User): string {
  return user.displayName || (user.isAnonymous ? 'Guest Player' : 'Player');
}

function getLoginMethod(user: User): LoginEvent['loginMethod'] {
  if (user.isAnonymous) return 'anonymous';
  if (user.providerData.some((provider) => provider?.providerId === 'google.com')) return 'google';
  return 'unknown';
}

function getProviderId(user: User): string {
  if (user.isAnonymous) return 'anonymous';
  return user.providerData.find((provider) => provider?.providerId)?.providerId || 'unknown';
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isVerified, setIsVerified] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [activeTournamentId, setActiveTournamentId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [newTourneyName, setNewTourneyName] = useState('');
  const [newTournamentFormat, setNewTournamentFormat] = useState<TournamentFormat>(DEFAULT_TOURNAMENT_FORMAT);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<LoginEvent[]>([]);
  const [guestModeId, setGuestModeId] = useState<string | null>(null);
  const [isHistorySelectionMode, setIsHistorySelectionMode] = useState(false);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const historyFormatCacheRef = useRef(new Map<string, TournamentFormat>());

  const adminEmail = 'yes.vinod@gmail.com';

  const mergeHistoryItem = (nextItem: HistoryItem) => {
    setHistory((prev) => {
      const remaining = prev.filter((item) => item.id !== nextItem.id);
      return [nextItem, ...remaining].sort((a, b) => {
        const aMs = a.joinedAt?.toMillis?.() ?? 0;
        const bMs = b.joinedAt?.toMillis?.() ?? 0;
        return bMs - aMs;
      });
    });
  };

  const loadUserHistory = async (uid: string) => {
    const qHistory = query(
      collection(db, 'users', uid, 'tournaments'),
      orderBy('joinedAt', 'desc')
    );

    const snap = await getDocs(qHistory);
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as HistoryItem));
    const historyWithFormats = await Promise.all(
      items.map(async (item) => {
        if (item.format) {
          const normalizedFormat = getTournamentFormat(item.format);
          historyFormatCacheRef.current.set(item.id, normalizedFormat);
          return { ...item, format: normalizedFormat };
        }

        const cachedFormat = historyFormatCacheRef.current.get(item.id);
        if (cachedFormat) {
          return { ...item, format: cachedFormat };
        }

        try {
          const tournamentSnap = await getDoc(doc(db, 'tournaments', item.id));
          const tournamentFormat = tournamentSnap.exists()
            ? getTournamentFormat(tournamentSnap.data().format as TournamentFormat | undefined)
            : DEFAULT_TOURNAMENT_FORMAT;
          historyFormatCacheRef.current.set(item.id, tournamentFormat);
          return { ...item, format: tournamentFormat };
        } catch (error) {
          console.error('History format lookup failed:', error);
          return { ...item, format: DEFAULT_TOURNAMENT_FORMAT };
        }
      })
    );

    setHistory(historyWithFormats);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view');
    if (viewParam) {
      setGuestModeId(viewParam);
      setLoading(false);
    }

    return onAuthStateChanged(auth, async (u) => {
      if (u?.isAnonymous) {
        await logout();
        setUser(null);
        setIsVerified(false);
        setAuthError('Guest access has been removed. Please continue with Google.');
        setLoading(false);
        return;
      }

      setUser(u);
      if (u) {
        setIsVerified(true);
        setLoading(false);
        recordLogin(u);
      } else {
        setHistory([]);
        setSelectedHistoryIds([]);
        setIsHistorySelectionMode(false);
        setLoading(false);
      }
    });
  }, []);

  const recordLogin = async (u: User) => {
    const sessionKey = `${LOGIN_SESSION_PREFIX}${u.uid}`;
    if (typeof window !== 'undefined' && window.sessionStorage.getItem(sessionKey)) {
      return;
    }

    try {
      await addDoc(collection(db, 'logins'), {
        uid: u.uid,
        displayName: getUserLabel(u),
        photoURL: u.photoURL || '',
        email: u.email || '',
        loginMethod: getLoginMethod(u),
        providerId: getProviderId(u),
        isAnonymous: u.isAnonymous,
        timestamp: serverTimestamp()
      });
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(sessionKey, '1');
      }
    } catch (e) {
      // Silently fail or log
      console.warn('Login tracking failed', e);
    }
  };

  useEffect(() => {
    if (!user || !isVerified) return;
    if (activeTournamentId || isAdminMode) return;

    void loadUserHistory(user.uid).catch((err) => {
      console.error('History load error:', err);
      setLoading(false);
    });

    let unsubLogins: (() => void) | undefined;

    if (user.email === adminEmail && isAdminMode) {
      const now = Timestamp.now();
      const qLogins = query(
        collection(db, 'logins'),
        where('timestamp', '>', now),
        orderBy('timestamp', 'desc'),
        limit(3)
      );

      unsubLogins = onSnapshot(qLogins, (snap) => {
        snap.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const data = change.doc.data() as LoginEvent;
            if (data.uid !== user.uid) {
              const newEvent = { id: change.doc.id, ...data };
              setNotifications(prev => [newEvent, ...prev].slice(0, 3));
              setTimeout(() => {
                setNotifications(prev => prev.filter(n => n.id !== change.doc.id));
              }, 5000);
            }
          }
        });
      }, (err) => {
        console.error('Logins listener error:', err);
      });
    } else {
      setNotifications([]);
    }

    return () => {
      unsubLogins?.();
    };
  }, [user, isVerified, isAdminMode, activeTournamentId]);

  const recordTournamentJoin = async (
    tId: string,
    name: string,
    code: string,
    role: 'owner' | 'player',
    format?: TournamentFormat
  ) => {
    if (!user) return;
    const normalizedFormat = getTournamentFormat(format);
    const joinedAt = Timestamp.now();

    await setDoc(doc(db, 'users', user.uid, 'tournaments', tId), {
      name,
      code,
      role,
      format: normalizedFormat,
      joinedAt: serverTimestamp()
    });

    historyFormatCacheRef.current.set(tId, normalizedFormat);
    mergeHistoryItem({
      id: tId,
      name,
      code,
      role,
      format: normalizedFormat,
      joinedAt,
    });
  };

  const createTournament = async () => {
    if (!user || !newTourneyName.trim()) return;
    setLoading(true);
    try {
      const code = generateCode();
      const docRef = await addDoc(collection(db, 'tournaments'), {
        name: newTourneyName,
        code,
        ownerId: user.uid,
        format: newTournamentFormat,
        status: 'setup',
        createdAt: serverTimestamp(),
      });
      await recordTournamentJoin(docRef.id, newTourneyName, code, 'owner', newTournamentFormat);
      setActiveTournamentId(docRef.id);
    } catch (e) {
      handleFirestoreError(e, 'create', 'tournaments');
    } finally {
      setLoading(false);
    }
  };

  const toggleHistorySelection = (tournamentId: string) => {
    setSelectedHistoryIds((prev) => (
      prev.includes(tournamentId)
        ? prev.filter((id) => id !== tournamentId)
        : [...prev, tournamentId]
    ));
  };

  const clearSelectedHistory = async () => {
    if (!user || selectedHistoryIds.length === 0) return;
    if (!window.confirm(`Remove ${selectedHistoryIds.length} recent activit${selectedHistoryIds.length === 1 ? 'y' : 'ies'} from your history?`)) {
      return;
    }

    setIsClearingHistory(true);
    setHistoryError(null);
    try {
      await Promise.all(
        selectedHistoryIds.map((tournamentId) => (
          deleteDoc(doc(db, 'users', user.uid, 'tournaments', tournamentId))
        ))
      );
      setHistory((prev) => prev.filter((item) => !selectedHistoryIds.includes(item.id)));
      setSelectedHistoryIds([]);
      setIsHistorySelectionMode(false);
    } catch (e) {
      console.error('History clear failed:', e);
      setHistoryError('Unable to clear selected history right now.');
    } finally {
      setIsClearingHistory(false);
    }
  };

  const joinByCode = async () => {
    if (!joinCode.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const q = query(collection(db, 'tournaments'), where('code', '==', joinCode.toUpperCase()));
      const snap = await getDocs(q);
      if (snap.empty) {
        setError('Tournament not found');
      } else {
        const t = snap.docs[0];
        const data = t.data();
        await recordTournamentJoin(
          t.id,
          data.name,
          data.code,
          data.ownerId === user?.uid ? 'owner' : 'player',
          data.format as TournamentFormat | undefined
        );
        setActiveTournamentId(t.id);
      }
    } catch (e) {
      setError('Error joining tournament');
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async () => {
    setAuthError(null);
    try {
      await signIn();
    } catch (e) {
      console.error('Google sign-in failed:', e);
      setAuthError(getAuthErrorMessage(e));
    }
  };

  if (guestModeId) {
    return (
      <Suspense fallback={<LoadingOverlay />}>
        <TournamentDashboard 
          tournamentId={guestModeId} 
          readOnly={true}
          onBack={() => {
            setGuestModeId(null);
            const newUrl = window.location.pathname;
            window.history.replaceState({}, '', newUrl);
          }} 
        />
      </Suspense>
    );
  }

  if (loading && !user) {
    return <LoadingOverlay />;
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-lime-50 p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full brutal-card p-8 text-center"
        >
          <div className="w-20 h-20 bg-lime-100 rounded-3xl flex items-center justify-center mx-auto mb-6 border-4 border-slate-800 rotate-3">
            <Trophy className="w-10 h-10 text-lime-600" />
          </div>
          <h1 className="text-4xl font-black text-lime-900 tracking-tight mb-2 uppercase">
            DINK<span className="text-orange-500">LY</span>
          </h1>
          <p className="text-lime-700 font-bold uppercase text-xs tracking-widest mb-8">
            Round Robin Mixer
          </p>
          <button
            onClick={handleSignIn}
            className="w-full brutal-button-orange flex items-center justify-center gap-3 text-lg"
          >
            CONTINUE WITH GOOGLE
            <ChevronRight className="w-5 h-5" />
          </button>
          <p className="mt-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
            Google sign-in is required for everyone.
          </p>
          {authError && (
            <div className="mt-4 bg-orange-50 border-2 border-orange-200 text-orange-700 px-4 py-3 rounded-xl font-bold text-sm text-left">
              {authError}
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  if (!isVerified) {
    return (
      <Suspense fallback={<LoadingOverlay />}>
        <Gatekeeper 
          user={user}
          onVerify={() => setIsVerified(true)} 
        />
      </Suspense>
    );
  }

  if (activeTournamentId) {
    return (
      <Suspense fallback={<LoadingOverlay />}>
        <TournamentDashboard 
          tournamentId={activeTournamentId} 
          onBack={() => setActiveTournamentId(null)} 
        />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen bg-lime-50 p-3 md:p-8">
      {/* Notifications Overlay */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {notifications.map((n) => (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, x: 100, scale: 0.8 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.2 } }}
              className="pointer-events-auto bg-white border-4 border-slate-800 rounded-2xl p-4 shadow-[4px_4px_0px_0px_rgba(30,41,59,1)] flex items-center gap-4 min-w-[280px]"
            >
              <div className="w-10 h-10 rounded-xl bg-lime-400 border-2 border-slate-800 flex items-center justify-center shrink-0">
                <Bell className="w-5 h-5 text-slate-900" />
              </div>
              <div className="flex-1">
                <p className="text-[10px] font-black text-lime-600 uppercase tracking-widest leading-none mb-1">New User Login</p>
                <h4 className="font-black text-slate-800 text-sm uppercase leading-tight truncate">{n.displayName} just joined the court!</h4>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mt-1">
                  {n.loginMethod === 'google' ? `Google${n.email ? ` • ${n.email}` : ''}` : n.loginMethod === 'anonymous' ? 'Guest Login' : 'Other Login'}
                </p>
              </div>
              <button 
                onClick={() => setNotifications(prev => prev.filter(item => item.id !== n.id))}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="max-w-xl mx-auto">
        <header className="flex items-center justify-between mb-8 md:mb-12">
          <div>
            <h1 className="text-xl md:text-3xl font-black text-lime-900 tracking-tight uppercase flex items-center gap-2">
              <span className="w-8 h-8 md:w-10 md:h-10 bg-lime-400 border-2 md:border-4 border-slate-900 rounded-xl flex items-center justify-center -rotate-3 text-slate-900 text-sm md:text-lg">D</span>
              {isAdminMode ? 'Admin Central' : 'Dinkly'}
            </h1>
            <p className="text-lime-700 font-bold uppercase text-[8px] md:text-[10px] tracking-widest">
              Active Player: {getUserLabel(user)}
            </p>
          </div>
          <div className="flex gap-2">
            {user.email === adminEmail && (
              <button 
                onClick={() => setIsAdminMode(!isAdminMode)}
                className={`p-2 md:p-3 border-2 md:border-4 border-slate-800 rounded-xl md:rounded-2xl shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] md:shadow-[4px_4px_0px_0px_rgba(30,41,59,1)] hover:translate-y-0.5 active:translate-y-1 active:shadow-none transition-all ${
                  isAdminMode ? 'bg-orange-400 text-white' : 'bg-white text-slate-800'
                }`}
              >
                <Shield className="w-4 h-4 md:w-5 md:h-5" />
              </button>
            )}
            <button 
              onClick={logout}
              className="p-2 md:p-3 bg-white border-2 md:border-4 border-slate-800 rounded-xl md:rounded-2xl shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] md:shadow-[4px_4px_0px_0px_rgba(30,41,59,1)] text-slate-800 hover:translate-y-0.5 active:translate-y-1 active:shadow-none transition-all"
            >
              <LogOut className="w-4 h-4 md:w-5 md:w-5" />
            </button>
          </div>
        </header>

        <Suspense fallback={<div className="p-12 text-center text-slate-400 font-bold animate-pulse uppercase tracking-widest">Loading View...</div>}>
          {isAdminMode ? (
            <AdminPanel onBack={() => setIsAdminMode(false)} />
          ) : (
            <>
              <div className="grid gap-4 md:gap-8">
                <motion.div 
                  whileHover={{ scale: 1.01 }}
                  className="bg-lime-400 border-2 md:border-4 border-slate-800 rounded-2xl md:rounded-3xl p-4 md:p-8 shadow-[4px_4px_0px_0px_rgba(30,41,59,1)] md:shadow-[8px_8px_0px_0px_rgba(30,41,59,1)] cursor-pointer relative overflow-hidden group"
                  onClick={() => {}}
                >
                  <div className="relative z-10">
                    <div className="w-8 h-8 md:w-12 md:h-12 bg-white border-2 border-slate-800 rounded-lg md:rounded-xl flex items-center justify-center mb-3 md:mb-6">
                      <Plus className="w-4 h-4 md:w-6 md:h-6 text-slate-800" />
                    </div>
                    <h2 className="text-xl md:text-3xl font-black text-slate-800 mb-2 md:mb-4">NEW TOURNEY</h2>
                    <div className="mb-3 md:mb-4">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-700">Format</span>
                        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-700">
                          {newTournamentFormat === 'doubles' ? 'Doubles' : 'Singles'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setNewTournamentFormat('doubles');
                          }}
                          className={`rounded-2xl border-4 px-3 py-3 text-left shadow-[4px_4px_0px_0px_rgba(30,41,59,1)] transition-all hover:translate-y-0.5 active:translate-y-1 active:shadow-none ${
                            newTournamentFormat === 'doubles'
                              ? 'border-slate-800 bg-white'
                              : 'border-slate-300 bg-lime-100/60 text-slate-500 shadow-none'
                          }`}
                          aria-pressed={newTournamentFormat === 'doubles'}
                        >
                          <div className="text-xs font-black uppercase text-slate-800">Doubles</div>
                          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
                            2v2 • 4 Players Min
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setNewTournamentFormat('singles');
                          }}
                          className={`rounded-2xl border-4 px-3 py-3 text-left shadow-[4px_4px_0px_0px_rgba(30,41,59,1)] transition-all hover:translate-y-0.5 active:translate-y-1 active:shadow-none ${
                            newTournamentFormat === 'singles'
                              ? 'border-slate-800 bg-white'
                              : 'border-slate-300 bg-lime-100/60 text-slate-500 shadow-none'
                          }`}
                          aria-pressed={newTournamentFormat === 'singles'}
                        >
                          <div className="text-xs font-black uppercase text-slate-800">Singles</div>
                          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
                            1v1 • 2 Players Min
                          </div>
                        </button>
                      </div>
                      <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-700">
                        {newTournamentFormat === 'doubles'
                          ? 'Classic partner format with two players per side.'
                          : 'Head-to-head rounds with one player per side.'}
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row items-center gap-2 md:gap-3">
                      <input 
                        type="text" 
                        value={newTourneyName}
                        onChange={(e) => setNewTourneyName(e.target.value)}
                        placeholder="Sat Night Mixer"
                        onClick={(e) => e.stopPropagation()}
                        className="brutal-input w-full text-sm md:text-base"
                      />
                      <button 
                        onClick={(e) => { e.stopPropagation(); createTournament(); }}
                        className="w-full sm:w-auto brutal-button-orange text-sm"
                      >
                        CREATE
                      </button>
                    </div>
                  </div>
                  <Trophy className="absolute -right-4 -bottom-4 md:-right-8 md:-bottom-8 w-24 h-24 md:w-48 md:h-48 text-white/20 rotate-12 group-hover:rotate-6 transition-transform duration-500" />
                </motion.div>

                <motion.div 
                  whileHover={{ scale: 1.01 }}
                  className="bg-white border-2 md:border-4 border-slate-800 rounded-2xl md:rounded-3xl p-4 md:p-8 shadow-[4px_4px_0px_0px_rgba(163,230,53,1)] md:shadow-[8px_8px_0px_0px_rgba(163,230,53,1)] group"
                >
                  <div className="flex-1">
                    <div className="w-8 h-8 md:w-12 md:h-12 bg-lime-50 border-2 border-slate-800 rounded-lg md:rounded-xl flex items-center justify-center mb-3 md:mb-6">
                      <Hash className="w-4 h-4 md:w-6 md:h-6 text-slate-400" />
                    </div>
                    <h2 className="text-xl md:text-2xl font-black text-slate-800 mb-2 md:mb-4 uppercase tracking-tight">Join by Code</h2>
                    <div className="flex flex-col sm:flex-row gap-2 md:gap-3">
                      <input 
                        type="text" 
                        maxLength={6}
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                        placeholder="CODE12"
                        className="brutal-input flex-1 font-mono tracking-widest text-lg md:text-2xl uppercase text-center sm:text-left"
                      />
                      <button 
                        onClick={joinByCode}
                        className="brutal-button-lime px-6 md:px-8 text-sm md:text-xl"
                      >
                        JOIN
                      </button>
                    </div>
                    {error && (
                      <div className="mt-4 bg-orange-50 border-2 border-orange-200 text-orange-600 px-4 py-2 rounded-xl font-bold text-sm uppercase">
                        {error}
                      </div>
                    )}
                  </div>
                </motion.div>
              </div>

              {history.length > 0 && (
                <div className="mt-8 md:mt-12">
                  <div className="mb-4 md:mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="text-lg md:text-2xl font-black text-slate-800 flex items-center gap-3 italic">
                      <History className="w-5 h-5 md:w-6 md:h-6 text-lime-600" />
                      RECENT ACTIVITY
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => {
                          setIsHistorySelectionMode((prev) => {
                            if (prev) {
                              setSelectedHistoryIds([]);
                            }
                            return !prev;
                          });
                        }}
                        className="bg-white border-2 border-slate-800 rounded-xl px-3 py-2 text-[10px] font-black uppercase shadow-[2px_2px_0px_0px_rgba(30,41,59,1)]"
                      >
                        <span className="inline-flex items-center gap-2">
                          {isHistorySelectionMode ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                          {isHistorySelectionMode ? 'Done Selecting' : 'Select History'}
                        </span>
                      </button>
                      {isHistorySelectionMode && (
                        <button
                          onClick={clearSelectedHistory}
                          disabled={selectedHistoryIds.length === 0 || isClearingHistory}
                          className="bg-orange-500 text-white border-2 border-slate-800 rounded-xl px-3 py-2 text-[10px] font-black uppercase shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span className="inline-flex items-center gap-2">
                            <Trash2 className="h-3.5 w-3.5" />
                            {isClearingHistory ? 'Clearing...' : `Clear Selected (${selectedHistoryIds.length})`}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-3 md:gap-4">
                    {historyError && (
                      <div className="bg-orange-50 border-2 border-orange-200 text-orange-700 px-4 py-3 rounded-xl font-bold text-sm">
                        {historyError}
                      </div>
                    )}
                    {history.map((item) => (
                      <motion.div
                        key={item.id}
                        whileHover={{ x: 4 }}
                        onClick={() => {
                          if (isHistorySelectionMode) {
                            toggleHistorySelection(item.id);
                            return;
                          }
                          setActiveTournamentId(item.id);
                        }}
                        className="bg-white border-2 md:border-4 border-slate-800 rounded-2xl md:rounded-3xl p-4 md:p-6 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] md:shadow-[4px_4px_0px_0px_rgba(30,41,59,1)] cursor-pointer flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-3 md:gap-4">
                          {isHistorySelectionMode && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleHistorySelection(item.id);
                              }}
                              className={`flex h-8 w-8 items-center justify-center rounded-lg border-2 border-slate-800 ${selectedHistoryIds.includes(item.id) ? 'bg-orange-400 text-white' : 'bg-white text-slate-800'}`}
                            >
                              {selectedHistoryIds.includes(item.id) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                            </button>
                          )}
                          <div className={`w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl border-2 border-slate-800 flex items-center justify-center shadow-[1.5px_1.5px_0px_0px_rgba(30,41,59,1)] md:shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] ${
                            item.role === 'owner' ? 'bg-orange-100' : 'bg-lime-100'
                          }`}>
                            {item.role === 'owner' ? <Plus className="w-5 h-5 md:w-6 md:h-6 text-orange-600" /> : <Users className="w-5 h-5 md:w-6 md:h-6 text-lime-600" />}
                          </div>
                          <div>
                            <h3 className="font-black text-sm md:text-base text-slate-800 uppercase tracking-tight leading-tight">{item.name}</h3>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <span className="text-[8px] md:text-[10px] font-mono font-black text-slate-400 bg-slate-50 px-1.5 rounded border border-slate-100 uppercase">
                                {item.code}
                              </span>
                              <span className="inline-flex items-center gap-1 rounded-md border border-orange-300 bg-orange-100 px-2 py-0.5 text-[8px] md:text-[10px] font-black uppercase text-orange-700">
                                <span>{getTournamentFormatTag(item.format).label}</span>
                                <span className="text-orange-500">•</span>
                                <span>{getTournamentFormatTag(item.format).detail}</span>
                              </span>
                              <span className="text-[8px] md:text-[10px] font-bold text-slate-300 uppercase flex items-center gap-1">
                                <Calendar className="w-2.5 h-2.5 md:w-3 md:h-3" />
                                {item.joinedAt?.toDate().toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        </div>
                        {!isHistorySelectionMode && (
                          <ChevronRight className="w-5 h-5 md:w-6 md:h-6 text-slate-300 group-hover:text-slate-800 transition-colors" />
                        )}
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </Suspense>
  </div>
</div>
  );
}
