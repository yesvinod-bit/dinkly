import React, { useState, useEffect, Suspense, lazy } from 'react';
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
  serverTimestamp,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  limit,
  Timestamp
} from 'firebase/firestore';
import { auth, db, signIn, signInAsGuest, logout, Tournament, handleFirestoreError } from './lib/firebase';
import { generateCode } from './lib/tournamentLogic';
import { Trophy, Users, Plus, Hash, LogOut, ChevronRight, History, Calendar, Bell, X, Shield, Loader2 } from 'lucide-react';
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
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<LoginEvent[]>([]);
  const [guestModeId, setGuestModeId] = useState<string | null>(null);

  const adminEmail = 'yes.vinod@gmail.com';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view');
    if (viewParam) {
      setGuestModeId(viewParam);
      setLoading(false);
    }

    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        setIsVerified(true);
        setLoading(false);
        recordLogin(u);
      } else {
        setHistory([]);
        setLoading(false);
      }
    });
  }, []);

  const recordLogin = async (u: User) => {
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
    } catch (e) {
      // Silently fail or log
      console.warn('Login tracking failed', e);
    }
  };

  useEffect(() => {
    if (!user || !isVerified) return;
    
    // Listen to user history
    const qHistory = query(
      collection(db, 'users', user.uid, 'tournaments'),
      orderBy('joinedAt', 'desc')
    );
    const unsubHistory = onSnapshot(qHistory, (snap) => {
      setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() } as HistoryItem)));
      setLoading(false);
    }, (err) => {
      console.error('History listener error:', err);
      setLoading(false);
    });

    // Listen to global logins for notifications
    const now = Timestamp.now();
    const qLogins = query(
      collection(db, 'logins'),
      where('timestamp', '>', now),
      orderBy('timestamp', 'desc'),
      limit(3)
    );
    
    const unsubLogins = onSnapshot(qLogins, (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data() as LoginEvent;
          if (data.uid !== user.uid) { // Don't notify for myself
            const newEvent = { id: change.doc.id, ...data };
            setNotifications(prev => [newEvent, ...prev].slice(0, 3));
            // Auto remove after 5 seconds
            setTimeout(() => {
              setNotifications(prev => prev.filter(n => n.id !== change.doc.id));
            }, 5000);
          }
        }
      });
    }, (err) => {
      console.error('Logins listener error:', err);
    });

    return () => {
      unsubHistory();
      unsubLogins();
    };
  }, [user, isVerified]);

  const recordTournamentJoin = async (tId: string, name: string, code: string, role: 'owner' | 'player') => {
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid, 'tournaments', tId), {
      name,
      code,
      role,
      joinedAt: serverTimestamp()
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
        status: 'setup',
        createdAt: serverTimestamp(),
      });
      await recordTournamentJoin(docRef.id, newTourneyName, code, 'owner');
      setActiveTournamentId(docRef.id);
    } catch (e) {
      handleFirestoreError(e, 'create', 'tournaments');
    } finally {
      setLoading(false);
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
        await recordTournamentJoin(t.id, data.name, data.code, data.ownerId === user?.uid ? 'owner' : 'player');
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

  const handleGuestSignIn = async () => {
    setAuthError(null);
    try {
      await signInAsGuest();
    } catch (e) {
      console.error('Anonymous sign-in failed:', e);
      setAuthError('Guest sign-in failed. Check Firebase Authentication settings and try again.');
    }
  };

  if (guestModeId) {
    return (
      <Suspense fallback={<LoadingOverlay />}>
        <TournamentDashboard 
          tournamentId={guestModeId} 
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
          <button
            onClick={handleGuestSignIn}
            className="w-full mt-3 bg-white border-4 border-slate-800 rounded-2xl py-4 px-5 text-slate-800 font-black uppercase tracking-tight shadow-[4px_4px_0px_0px_rgba(30,41,59,1)] hover:translate-y-0.5 active:translate-y-1 active:shadow-none transition-all"
          >
            CONTINUE AS GUEST
          </button>
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
                  <h2 className="text-lg md:text-2xl font-black text-slate-800 mb-4 md:mb-6 flex items-center gap-3 italic">
                    <History className="w-5 h-5 md:w-6 md:h-6 text-lime-600" />
                    RECENT ACTIVITY
                  </h2>
                  <div className="grid gap-3 md:gap-4">
                    {history.map((item) => (
                      <motion.div
                        key={item.id}
                        whileHover={{ x: 4 }}
                        onClick={() => setActiveTournamentId(item.id)}
                        className="bg-white border-2 md:border-4 border-slate-800 rounded-2xl md:rounded-3xl p-4 md:p-6 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] md:shadow-[4px_4px_0px_0px_rgba(30,41,59,1)] cursor-pointer flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-3 md:gap-4">
                          <div className={`w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl border-2 border-slate-800 flex items-center justify-center shadow-[1.5px_1.5px_0px_0px_rgba(30,41,59,1)] md:shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] ${
                            item.role === 'owner' ? 'bg-orange-100' : 'bg-lime-100'
                          }`}>
                            {item.role === 'owner' ? <Plus className="w-5 h-5 md:w-6 md:h-6 text-orange-600" /> : <Users className="w-5 h-5 md:w-6 md:h-6 text-lime-600" />}
                          </div>
                          <div>
                            <h3 className="font-black text-sm md:text-base text-slate-800 uppercase tracking-tight leading-tight">{item.name}</h3>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[8px] md:text-[10px] font-mono font-black text-slate-400 bg-slate-50 px-1.5 rounded border border-slate-100 uppercase">
                                {item.code}
                              </span>
                              <span className="text-[8px] md:text-[10px] font-bold text-slate-300 uppercase flex items-center gap-1">
                                <Calendar className="w-2.5 h-2.5 md:w-3 md:h-3" />
                                {item.joinedAt?.toDate().toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 md:w-6 md:h-6 text-slate-300 group-hover:text-slate-800 transition-colors" />
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
