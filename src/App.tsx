import React, { useState, useEffect, useRef, useMemo, Suspense, lazy } from 'react';
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
import { auth, db, signIn, logout, Tournament, TournamentFormat, TournamentPairingMode, getReadableFirestoreError } from './lib/firebase';
import {
  DEFAULT_TOURNAMENT_FORMAT,
  DEFAULT_TOURNAMENT_PAIRING_MODE,
  generateCode,
  getTournamentFormat,
  getTournamentFormatTag
} from './lib/tournamentLogic';
import { Trophy, Users, Plus, Hash, LogOut, ChevronRight, History, Calendar, Bell, X, Shield, Loader2, CheckSquare, Square, Trash2, BadgeCheck, Download, Home, Activity, PlayCircle, RefreshCw, Sparkles, Shuffle, Link2, ClipboardPaste, Repeat2 } from 'lucide-react';
import { buildProfileAdvice } from './lib/profileAdvice';
import { motion, AnimatePresence } from 'motion/react';

// Lazy load heavy components
const TournamentDashboard = lazy(() => import('./components/TournamentDashboard'));
const Gatekeeper = lazy(() => import('./components/Gatekeeper'));
const AdminPanel = lazy(() => import('./components/AdminPanel'));

function BrandMark({ size = 'md', withWordmark = false, subtitle }: { size?: 'sm' | 'md' | 'lg'; withWordmark?: boolean; subtitle?: string }) {
  const shellSize = size === 'lg' ? 'h-20 w-20 rounded-[28px]' : size === 'sm' ? 'h-10 w-10 rounded-2xl' : 'h-12 w-12 rounded-3xl';
  const imgSize = size === 'lg' ? 'h-14 w-14 rounded-3xl' : size === 'sm' ? 'h-7 w-7 rounded-xl' : 'h-8 w-8 rounded-2xl';
  const titleSize = size === 'lg' ? 'text-4xl' : size === 'sm' ? 'text-lg' : 'text-2xl';

  return (
    <div className="flex items-center gap-3">
      <div className={`relative flex items-center justify-center border-4 border-slate-900 bg-[radial-gradient(circle_at_top_left,#fde68a_0%,#a3e635_26%,#0f172a_72%)] shadow-[6px_6px_0px_0px_rgba(30,41,59,1)] ${shellSize}`}>
        <img
          src="/icons/icon-192.png"
          alt="Dinkly"
          className={`${imgSize} border-2 border-white/40 object-cover shadow-[0_8px_24px_rgba(15,23,42,0.35)]`}
        />
      </div>
      {withWordmark && (
        <div>
          <div className={`font-black uppercase tracking-tight text-lime-950 ${titleSize}`}>
            Dink<span className="text-orange-500">ly</span>
          </div>
          {subtitle && (
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-lime-700">
              {subtitle}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const LoadingOverlay = () => (
  <div className="fixed inset-0 bg-lime-50/80 backdrop-blur-sm z-[200] flex flex-col items-center justify-center">
    <div className="bg-white p-8 rounded-3xl border-4 border-slate-900 shadow-[8px_8px_0px_0px_rgba(30,41,59,1)] flex flex-col items-center">
      <BrandMark size="md" withWordmark subtitle="Round Robin Mixer" />
      <Loader2 className="w-12 h-12 text-lime-500 animate-spin mb-4" />
      <h2 className="text-xl font-black text-slate-800 uppercase italic tracking-tighter">Loading the court...</h2>
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

interface ClaimedTournamentProfile {
  tournamentId: string;
  tournamentName: string;
  tournamentCode: string;
  tournamentFormat: TournamentFormat;
  tournamentStatus: Tournament['status'];
  playerName: string;
  points: number;
  gamesPlayed: number;
  wins: number;
  claimedAt?: Timestamp;
  joinedAt?: Timestamp;
}

interface FormatStatsSummary {
  tournaments: number;
  games: number;
  wins: number;
  points: number;
  winRate: number;
}

interface PlayerProfileSummary {
  displayName: string;
  claimedTournamentCount: number;
  activeTournamentCount: number;
  completedTournamentCount: number;
  totalGames: number;
  totalWins: number;
  totalPoints: number;
  winRate: number;
  formatBreakdown: Record<TournamentFormat, FormatStatsSummary>;
  recentClaimedTournaments: ClaimedTournamentProfile[];
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

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const LOGIN_SESSION_PREFIX = 'dinkly:login-recorded:';
const PROFILE_ADVICE_REFRESH_MS = 20_000;

const tournamentNameOpeners = [
  'Dink & Dash',
  'Kitchen Chaos',
  'Paddle Party',
  'Net Results',
  'Court Jesters',
  'Drop Shot Social',
  'Rally Club',
  'Pickle Panic',
  'Third Shot Throwdown',
  'Lob Mob',
  'Dink Dynasty',
  'No Volley Zone',
];

function buildSuggestedTournamentName(date = new Date()) {
  const dateLabel = date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
  const opener = tournamentNameOpeners[Math.floor(Math.random() * tournamentNameOpeners.length)];
  return `${dateLabel} ${opener}`;
}

function getSharedTournamentIdFromInput(value: string) {
  try {
    const url = new URL(value.trim());
    return url.searchParams.get('join') || url.searchParams.get('view');
  } catch {
    return null;
  }
}

function normalizeTournamentCodeInput(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function isRunningStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
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
  const [newTourneyName, setNewTourneyName] = useState(() => buildSuggestedTournamentName());
  const [newTournamentFormat, setNewTournamentFormat] = useState<TournamentFormat>(DEFAULT_TOURNAMENT_FORMAT);
  const [newTournamentPairingMode, setNewTournamentPairingMode] = useState<TournamentPairingMode>(DEFAULT_TOURNAMENT_PAIRING_MODE);
  const [newLeagueMode, setNewLeagueMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<LoginEvent[]>([]);
  const [sharedTournamentId, setSharedTournamentId] = useState<string | null>(null);
  const [sharedTournamentRequiresSignIn, setSharedTournamentRequiresSignIn] = useState(false);
  const [isHistorySelectionMode, setIsHistorySelectionMode] = useState(false);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const [playerProfile, setPlayerProfile] = useState<PlayerProfileSummary | null>(null);
  const [isPlayerProfileLoading, setIsPlayerProfileLoading] = useState(false);
  const [playerProfileError, setPlayerProfileError] = useState<string | null>(null);
  const [isPlayerProfileOpen, setIsPlayerProfileOpen] = useState(false);
  const [selectedProfileFormat, setSelectedProfileFormat] = useState<TournamentFormat>('doubles');
  const [profileAdviceNonce, setProfileAdviceNonce] = useState(() => Date.now());
  const [isJoiningSharedTournament, setIsJoiningSharedTournament] = useState(false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isAppInstalled, setIsAppInstalled] = useState(() => typeof window !== 'undefined' && isRunningStandalone());
  const [homeView, setHomeView] = useState<'home' | 'activity' | 'profile'>('home');
  const historyFormatCacheRef = useRef(new Map<string, TournamentFormat>());

  const adminEmail = 'yes.vinod@gmail.com';
  const isFirstRun = history.length === 0 && !isPlayerProfileLoading;
  const profileAdvice = useMemo(() => (
    playerProfile
      ? buildProfileAdvice(playerProfile, selectedProfileFormat, profileAdviceNonce)
      : null
  ), [playerProfile, profileAdviceNonce, selectedProfileFormat]);

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
    return historyWithFormats;
  };

  const loadPlayerProfile = async (uid: string, historyItems: HistoryItem[]) => {
    setIsPlayerProfileLoading(true);
    setPlayerProfileError(null);

    try {
      const historyByTournamentId = new Map(historyItems.map((item) => [item.id, item]));
      const claimedProfiles = (await Promise.all(
        historyItems.map(async (historyEntry) => {
          const tournamentId = historyEntry.id;
          const playersSnap = await getDocs(collection(db, 'tournaments', tournamentId, 'players'));
          const playerDoc = playersSnap.docs.find((docSnap) => docSnap.data().claimedByUserId === uid);

          if (!playerDoc) return null;

          const player = playerDoc.data();

          const historyItem = historyByTournamentId.get(tournamentId);
          let tournamentName = historyItem?.name || 'Tournament';
          let tournamentCode = historyItem?.code || '------';
          let tournamentFormat = getTournamentFormat(historyItem?.format);
          let tournamentStatus: Tournament['status'] = 'setup';
          let joinedAt = historyItem?.joinedAt as Timestamp | undefined;
          let points = 0;
          let gamesPlayed = 0;
          let wins = 0;

          try {
            const tournamentSnap = await getDoc(doc(db, 'tournaments', tournamentId));
            if (tournamentSnap.exists()) {
              const tournamentData = tournamentSnap.data() as Tournament;
              tournamentName = tournamentData.name;
              tournamentCode = tournamentData.code;
              tournamentFormat = getTournamentFormat(tournamentData.format);
              tournamentStatus = tournamentData.status;
              joinedAt = historyItem?.joinedAt as Timestamp | undefined || tournamentData.createdAt;
            }
          } catch (error) {
            console.error('Claimed tournament lookup failed:', error);
          }

          try {
            const matchesSnap = await getDocs(collection(db, 'tournaments', tournamentId, 'matches'));
            matchesSnap.docs.forEach((matchDoc) => {
              const match = matchDoc.data();
              if (match.status !== 'completed') return;

              const isTeam1 = Array.isArray(match.team1) && match.team1.includes(playerDoc.id);
              const isTeam2 = Array.isArray(match.team2) && match.team2.includes(playerDoc.id);
              if (!isTeam1 && !isTeam2) return;

              gamesPlayed += 1;
              const scoreFor = isTeam1 ? match.score1 : match.score2;
              const scoreAgainst = isTeam1 ? match.score2 : match.score1;
              if (scoreFor > scoreAgainst) {
                wins += 1;
              }
              points += scoreFor - scoreAgainst;
            });
          } catch (error) {
            console.error('Claimed tournament match lookup failed:', error);
          }

          return {
            tournamentId,
            tournamentName,
            tournamentCode,
            tournamentFormat,
            tournamentStatus,
            playerName: player.name || 'Player',
            points,
            gamesPlayed,
            wins,
            claimedAt: player.claimedAt as Timestamp | undefined,
            joinedAt,
          } as ClaimedTournamentProfile;
        })
      )).filter((item): item is ClaimedTournamentProfile => item !== null);

      claimedProfiles.sort((a, b) => {
        const aMs = a.claimedAt?.toMillis?.() ?? a.joinedAt?.toMillis?.() ?? 0;
        const bMs = b.claimedAt?.toMillis?.() ?? b.joinedAt?.toMillis?.() ?? 0;
        return bMs - aMs;
      });

      const totalGames = claimedProfiles.reduce((sum, item) => sum + item.gamesPlayed, 0);
      const totalWins = claimedProfiles.reduce((sum, item) => sum + item.wins, 0);
      const totalPoints = claimedProfiles.reduce((sum, item) => sum + item.points, 0);
      const activeTournamentCount = claimedProfiles.filter((item) => item.tournamentStatus === 'active').length;
      const completedTournamentCount = claimedProfiles.filter((item) => item.tournamentStatus === 'completed').length;
      const formatBreakdown = {
        doubles: { tournaments: 0, games: 0, wins: 0, points: 0, winRate: 0 },
        singles: { tournaments: 0, games: 0, wins: 0, points: 0, winRate: 0 },
      } satisfies Record<TournamentFormat, FormatStatsSummary>;

      claimedProfiles.forEach((item) => {
        const current = formatBreakdown[item.tournamentFormat];
        current.tournaments += 1;
        current.games += item.gamesPlayed;
        current.wins += item.wins;
        current.points += item.points;
      });

      (Object.keys(formatBreakdown) as TournamentFormat[]).forEach((formatKey) => {
        const current = formatBreakdown[formatKey];
        current.winRate = current.games > 0 ? Math.round((current.wins / current.games) * 100) : 0;
      });

      setPlayerProfile({
        displayName: claimedProfiles[0]?.playerName || getUserLabel(auth.currentUser as User),
        claimedTournamentCount: claimedProfiles.length,
        activeTournamentCount,
        completedTournamentCount,
        totalGames,
        totalWins,
        totalPoints,
        winRate: totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0,
        formatBreakdown,
        recentClaimedTournaments: claimedProfiles.slice(0, 3),
      });
      setIsPlayerProfileOpen((prev) => prev && claimedProfiles.length > 0);
    } catch (error) {
      console.error('Player profile load failed:', error);
      setPlayerProfile(null);
      setIsPlayerProfileOpen(false);
      setPlayerProfileError('Unable to load your player profile right now.');
    } finally {
      setIsPlayerProfileLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinParam = params.get('join');
    const sharedParam = joinParam || params.get('view');
    if (sharedParam) {
      setSharedTournamentId(sharedParam);
      setSharedTournamentRequiresSignIn(Boolean(joinParam));
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
        setPlayerProfile(null);
        setPlayerProfileError(null);
        setIsPlayerProfileOpen(false);
        setLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const handleInstalled = () => {
      setDeferredInstallPrompt(null);
      setIsAppInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
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
    let unsubLogins: (() => void) | undefined;
    const isOnTournamentView = Boolean(activeTournamentId || sharedTournamentId);

    if (!isOnTournamentView && !isAdminMode) {
      void (async () => {
        try {
          const historyItems = await loadUserHistory(user.uid);
          await loadPlayerProfile(user.uid, historyItems);
        } catch (err) {
          console.error('History load error:', err);
          setLoading(false);
        }
      })();
    }

    if (!isOnTournamentView && user.email === adminEmail && isAdminMode) {
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
  }, [user, isVerified, isAdminMode, activeTournamentId, sharedTournamentId]);

  const handleInstallApp = async () => {
    if (!deferredInstallPrompt) return;

    const promptEvent = deferredInstallPrompt;
    setDeferredInstallPrompt(null);
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted') {
      setIsAppInstalled(true);
    }
  };

  useEffect(() => {
    if (!user || !isVerified || !sharedTournamentId) return;

    let cancelled = false;

    void (async () => {
      setIsJoiningSharedTournament(true);

      try {
        const membershipSnap = await getDoc(doc(db, 'users', user.uid, 'tournaments', sharedTournamentId));
        if (membershipSnap.exists() || cancelled) {
          return;
        }

        const tournamentSnap = await getDoc(doc(db, 'tournaments', sharedTournamentId));
        if (!tournamentSnap.exists() || cancelled) {
          return;
        }

        const tournamentData = tournamentSnap.data() as Tournament;
        await recordTournamentJoin(
          sharedTournamentId,
          tournamentData.name,
          tournamentData.code,
          tournamentData.ownerId === user.uid ? 'owner' : 'player',
          tournamentData.format
        );
      } catch (error) {
        console.error('Shared tournament join failed:', error);
      } finally {
        if (!cancelled) {
          setIsJoiningSharedTournament(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, isVerified, sharedTournamentId]);

  useEffect(() => {
    if (!playerProfile) return;

    const doublesHasData = playerProfile.formatBreakdown.doubles.tournaments > 0;
    const singlesHasData = playerProfile.formatBreakdown.singles.tournaments > 0;

    if (doublesHasData) {
      setSelectedProfileFormat('doubles');
      return;
    }

    if (singlesHasData) {
      setSelectedProfileFormat('singles');
    }
  }, [playerProfile]);

  useEffect(() => {
    if (homeView === 'profile' && playerProfile) {
      setProfileAdviceNonce(Date.now());
    }
  }, [homeView, playerProfile?.totalGames, playerProfile?.totalPoints, playerProfile?.totalWins, playerProfile?.winRate]);

  useEffect(() => {
    if (homeView !== 'profile' || !playerProfile) return;

    const refreshAdvice = () => {
      if (document.visibilityState === 'visible') {
        setProfileAdviceNonce((current) => current + 1);
      }
    };

    const intervalId = window.setInterval(refreshAdvice, PROFILE_ADVICE_REFRESH_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshAdvice();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [homeView, playerProfile, selectedProfileFormat]);

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
    if (!user) return;
    setLoading(true);
    try {
      const code = generateCode();
      const tournamentName = newTourneyName.trim() || buildSuggestedTournamentName();
      const docRef = await addDoc(collection(db, 'tournaments'), {
        name: tournamentName,
        code,
        ownerId: user.uid,
        format: newTournamentFormat,
        pairingMode: newTournamentFormat === 'doubles' ? newTournamentPairingMode : DEFAULT_TOURNAMENT_PAIRING_MODE,
        leagueMode: newTournamentFormat === 'doubles' && newTournamentPairingMode === 'fixed' ? newLeagueMode : false,
        status: 'setup',
        createdAt: serverTimestamp(),
      });
      await recordTournamentJoin(docRef.id, tournamentName, code, 'owner', newTournamentFormat);
      setActiveTournamentId(docRef.id);
    } catch (e) {
      setError(getReadableFirestoreError(e, 'Unable to create the tournament right now.'));
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
      const sharedTournamentIdFromInput = getSharedTournamentIdFromInput(joinCode);
      if (sharedTournamentIdFromInput) {
        setSharedTournamentId(sharedTournamentIdFromInput);
        setSharedTournamentRequiresSignIn(true);
        setLoading(false);
        return;
      }

      const normalizedCode = normalizeTournamentCodeInput(joinCode);
      if (normalizedCode.length !== 6) {
        setError('Enter a 6-character code or paste an invite link');
        setLoading(false);
        return;
      }

      const q = query(collection(db, 'tournaments'), where('code', '==', normalizedCode));
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

  const pasteJoinCode = async () => {
    if (!navigator.clipboard?.readText) return;
    try {
      const text = await navigator.clipboard.readText();
      const sharedTournamentIdFromInput = getSharedTournamentIdFromInput(text);
      setJoinCode(sharedTournamentIdFromInput ? text : normalizeTournamentCodeInput(text));
    } catch (error) {
      console.warn('Unable to read clipboard:', error);
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

  if (sharedTournamentId && !user && !sharedTournamentRequiresSignIn) {
    return (
      <Suspense fallback={<LoadingOverlay />}>
        <TournamentDashboard 
          tournamentId={sharedTournamentId} 
          readOnly={true}
          onBack={() => {
            setSharedTournamentId(null);
            setSharedTournamentRequiresSignIn(false);
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
          <div className="mb-6 flex justify-center">
            <BrandMark size="lg" />
          </div>
          <h1 className="text-4xl font-black text-lime-950 tracking-tight mb-2 uppercase">
            Dink<span className="text-orange-500">ly</span>
          </h1>
          <p className="text-lime-700 font-bold uppercase text-xs tracking-[0.24em] mb-2">
            Round Robin Mixer
          </p>
          <p className="mb-8 text-sm font-bold text-slate-600">
            Live pairings, fast score entry, and a courtside view that feels like an app.
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
          {deferredInstallPrompt && !isAppInstalled && (
            <button
              type="button"
              onClick={handleInstallApp}
              className="mt-4 w-full rounded-2xl border-2 border-slate-800 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-slate-800 shadow-[3px_3px_0px_0px_rgba(30,41,59,1)] transition-all hover:translate-y-0.5 active:translate-y-1 active:shadow-none"
            >
              <span className="inline-flex items-center justify-center gap-2">
                <Download className="h-4 w-4" />
                Install Dinkly
              </span>
            </button>
          )}
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

  if (sharedTournamentId && isJoiningSharedTournament) {
    return <LoadingOverlay />;
  }

  if (sharedTournamentId) {
    return (
      <Suspense fallback={<LoadingOverlay />}>
        <TournamentDashboard
          tournamentId={sharedTournamentId}
          readOnly={false}
          onBack={() => {
            setSharedTournamentId(null);
            setSharedTournamentRequiresSignIn(false);
            const newUrl = window.location.pathname;
            window.history.replaceState({}, '', newUrl);
          }}
        />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen bg-lime-50 p-3 pb-24 transition-colors md:p-8">
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

      <div className="max-w-3xl mx-auto">
        <header className="mb-5 rounded-2xl border-2 border-slate-800 bg-white/95 p-3 shadow-[3px_3px_0px_0px_rgba(30,41,59,1)] backdrop-blur md:mb-8 md:p-5">
          <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <BrandMark size="sm" />
              <div>
                <h1 className="text-xl md:text-3xl font-black text-lime-900 tracking-tight uppercase leading-none">
                  {isAdminMode ? 'Admin Central' : 'Dinkly'}
                </h1>
                <p className="mt-1 text-[8px] md:text-[10px] font-black uppercase tracking-[0.22em] text-lime-700">
                  {isAdminMode ? 'Control Room' : 'Pickleball Mixer'}
                </p>
              </div>
            </div>
            <p className="mt-2 text-lime-700 font-bold uppercase text-[8px] md:text-[10px] tracking-widest">
              Active Player: {getUserLabel(user)}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setHomeView('profile');
                setIsPlayerProfileOpen(true);
              }}
              className={`p-2 md:p-3 border-2 md:border-4 border-slate-800 rounded-xl md:rounded-2xl shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] md:shadow-[4px_4px_0px_0px_rgba(30,41,59,1)] transition-all ${
                homeView === 'profile' || isPlayerProfileOpen ? 'bg-sky-400 text-slate-900' : 'bg-white text-slate-800'
              }`}
              title="My Profile"
            >
              <BadgeCheck className="w-4 h-4 md:w-5 md:h-5" />
            </button>
            {user.email === adminEmail && (
              <button 
                onClick={() => {
                  setIsAdminMode(!isAdminMode);
                  setHomeView('home');
                }}
                className={`p-2 md:p-3 border-2 md:border-4 border-slate-800 rounded-xl md:rounded-2xl shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] md:shadow-[4px_4px_0px_0px_rgba(30,41,59,1)] hover:translate-y-0.5 active:translate-y-1 active:shadow-none transition-all ${
                  isAdminMode ? 'bg-orange-400 text-white' : 'bg-white text-slate-800'
                }`}
                title="Admin"
              >
                <Shield className="w-4 h-4 md:w-5 md:h-5" />
              </button>
            )}
            <button 
              onClick={logout}
              title="Sign out"
              className="p-2 md:p-3 bg-white border-2 md:border-4 border-slate-800 rounded-xl md:rounded-2xl shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] md:shadow-[4px_4px_0px_0px_rgba(30,41,59,1)] text-slate-800 hover:translate-y-0.5 active:translate-y-1 active:shadow-none transition-all"
            >
              <LogOut className="w-4 h-4 md:w-5 md:h-5" />
            </button>
          </div>
          </div>

          {!isAdminMode && (
            <div className="mt-4 grid grid-cols-3 gap-2 md:hidden">
              {[
                { key: 'home', label: 'Home', icon: Home },
                { key: 'activity', label: 'Activity', icon: Activity },
                { key: 'profile', label: 'Profile', icon: BadgeCheck },
              ].map((item) => {
                const Icon = item.icon;
                const isActive = homeView === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setHomeView(item.key as typeof homeView);
                      setIsPlayerProfileOpen(item.key === 'profile');
                    }}
                    className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border-2 border-slate-800 text-[10px] font-black uppercase ${
                      isActive ? 'bg-lime-400 text-slate-900' : 'bg-white text-slate-700'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </header>

        {!isAdminMode && (
          <section className="mb-5 flex flex-wrap items-center gap-2">
            <span className="status-pill border-slate-300 bg-white text-slate-600">
              <Activity className="h-3.5 w-3.5" />
              {history.length} saved
            </span>
          </section>
        )}

        <Suspense fallback={<div className="p-12 text-center text-slate-400 font-bold animate-pulse uppercase tracking-widest">Loading View...</div>}>
          {isAdminMode ? (
            <AdminPanel onBack={() => setIsAdminMode(false)} />
          ) : (
            <>
              {homeView === 'home' && isFirstRun && (
                <section className="mb-6 rounded-2xl border-2 border-slate-800 bg-white p-5 shadow-[3px_3px_0px_0px_rgba(30,41,59,1)]">
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 border-slate-800 bg-lime-400">
                      <PlayCircle className="h-5 w-5 text-slate-900" />
                    </div>
                    <div>
                      <h2 className="text-lg font-black uppercase text-slate-900">Start your first mixer</h2>
                  <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                        Create a mixer or join by code to get started.
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <a href="#create-mixer" className="rounded-xl border-2 border-slate-800 bg-lime-400 px-3 py-3 text-center text-[10px] font-black uppercase text-slate-900">
                      Create mixer
                    </a>
                    <a href="#join-mixer" className="rounded-xl border-2 border-slate-800 bg-white px-3 py-3 text-center text-[10px] font-black uppercase text-slate-800">
                      Join code
                    </a>
                  </div>
                </section>
              )}

              {homeView === 'profile' && (
                <div className="mb-6 md:mb-8">
                  <div className="overflow-hidden rounded-2xl border-2 border-slate-800 bg-slate-900 text-white shadow-[3px_3px_0px_0px_rgba(56,189,248,1)]">
                    <div className="p-4 md:p-6">
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-600">My Profile</p>
                        <h2 className="mt-2 text-2xl md:text-3xl font-black uppercase tracking-tight text-white">
                          {playerProfile?.displayName || getUserLabel(user)}
                        </h2>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="inline-flex items-center gap-2 rounded-full border border-sky-300 bg-sky-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-sky-700">
                            <BadgeCheck className="h-3 w-3" />
                            Verified Player
                          </span>
                          {playerProfile && playerProfile.claimedTournamentCount > 0 && (
                            <span className="inline-flex items-center rounded-full border border-lime-300 bg-lime-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-lime-700">
                              {playerProfile.claimedTournamentCount} tournaments
                            </span>
                          )}
                          {playerProfile && playerProfile.totalGames > 0 && (
                            <span className="inline-flex items-center rounded-full border border-orange-300 bg-orange-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-orange-700">
                              {playerProfile.winRate}% win rate
                            </span>
                          )}
                        </div>
                        <p className="mt-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-300">
                          Your Dinkly results across claimed tournaments.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsPlayerProfileOpen(false);
                          setHomeView('home');
                        }}
                        className="rounded-2xl border-2 border-white/30 bg-white/10 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-white transition-all hover:bg-white/20"
                      >
                        Close Profile
                      </button>
                    </div>

                    {isPlayerProfileLoading ? (
                      <div className="mt-6 rounded-2xl border-2 border-dashed border-white/20 bg-white/5 px-4 py-8 text-center text-xs font-black uppercase tracking-[0.16em] text-slate-300">
                        Loading your stats...
                      </div>
                    ) : playerProfile && playerProfile.claimedTournamentCount > 0 ? (
                      <>
                        {profileAdvice && (
                          <div
                            className={`mt-6 rounded-3xl border-2 p-4 shadow-[2px_2px_0px_0px_rgba(14,165,233,0.35)] md:p-5 ${
                              profileAdvice.tone === 'humbling'
                                ? 'border-orange-300/40 bg-[linear-gradient(135deg,rgba(251,146,60,0.24),rgba(248,113,113,0.14))]'
                                : profileAdvice.tone === 'motivating'
                                  ? 'border-lime-300/40 bg-[linear-gradient(135deg,rgba(163,230,53,0.22),rgba(45,212,191,0.12))]'
                                  : profileAdvice.tone === 'new'
                                    ? 'border-violet-300/40 bg-[linear-gradient(135deg,rgba(167,139,250,0.22),rgba(56,189,248,0.12))]'
                                    : 'border-sky-300/40 bg-[linear-gradient(135deg,rgba(56,189,248,0.2),rgba(217,70,239,0.12))]'
                            }`}
                          >
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                              <div className="flex gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-white/10">
                                  <Sparkles className="h-5 w-5 text-white" />
                                </div>
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/70">
                                    Courtside Advice
                                  </p>
                                  <h3 className="mt-1 text-lg font-black uppercase text-white">
                                    {profileAdvice.title}
                                  </h3>
                                  <p className="mt-2 text-sm font-bold leading-relaxed text-white/90">
                                    {profileAdvice.message}
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => setProfileAdviceNonce((current) => current + 1)}
                                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/25 bg-white/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-all hover:bg-white/20"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                                New Roast
                              </button>
                            </div>
                          </div>
                        )}

                        {(() => {
                          const activeFormatStats = playerProfile.formatBreakdown[selectedProfileFormat];
                          const alternateFormat: TournamentFormat = selectedProfileFormat === 'doubles' ? 'singles' : 'doubles';
                          const alternateFormatStats = playerProfile.formatBreakdown[alternateFormat];

                          return (
                        <div className="mt-6 grid gap-4 lg:grid-cols-2">
                          <div className="rounded-3xl border-2 border-amber-300/30 bg-[linear-gradient(135deg,rgba(253,186,116,0.22),rgba(251,191,36,0.12))] p-5">
                            <h3 className="text-sm font-black uppercase tracking-[0.16em] text-amber-100">Overall Totals</h3>
                            <div className="mt-4 grid grid-cols-3 gap-3">
                              <div className="rounded-2xl bg-slate-950/20 px-3 py-3">
                                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-100/80">Games</div>
                                <div className="mt-1 text-xl font-black text-white">{playerProfile.totalGames}</div>
                              </div>
                              <div className="rounded-2xl bg-slate-950/20 px-3 py-3">
                                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-100/80">Wins</div>
                                <div className="mt-1 text-xl font-black text-white">{playerProfile.totalWins}</div>
                              </div>
                              <div className="rounded-2xl bg-slate-950/20 px-3 py-3">
                                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-100/80">Points</div>
                                <div className="mt-1 text-xl font-black text-white">{playerProfile.totalPoints}</div>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-3xl border-2 border-sky-300/30 bg-[linear-gradient(135deg,rgba(56,189,248,0.2),rgba(45,212,191,0.12))] p-5">
                            <div className="flex items-center justify-between gap-3">
                              <h3 className="text-sm font-black uppercase tracking-[0.16em] text-sky-100">Format View</h3>
                              <div className="inline-flex rounded-2xl border border-white/15 bg-slate-950/20 p-1">
                                {(['doubles', 'singles'] as TournamentFormat[]).map((formatKey) => {
                                  const isActive = selectedProfileFormat === formatKey;
                                  return (
                                    <button
                                      key={formatKey}
                                      type="button"
                                      onClick={() => setSelectedProfileFormat(formatKey)}
                                      className={`rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-all ${
                                        isActive
                                          ? 'bg-white text-slate-900'
                                          : 'text-sky-100/80 hover:bg-white/10'
                                      }`}
                                    >
                                      {getTournamentFormatTag(formatKey).label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                            <div className="mt-4 rounded-[28px] border border-white/15 bg-slate-950/20 p-5">
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <div className="text-lg font-black uppercase text-white">
                                    {getTournamentFormatTag(selectedProfileFormat).label}
                                  </div>
                                  <div className="mt-1 text-[10px] font-black uppercase tracking-[0.16em] text-sky-100/80">
                                    {activeFormatStats.tournaments} tournaments tracked
                                  </div>
                                </div>
                                <div className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white">
                                  {activeFormatStats.winRate}% win rate
                                </div>
                              </div>
                              <div className="mt-5 grid grid-cols-3 gap-3">
                                <div className="rounded-2xl bg-white/10 px-3 py-3">
                                  <div className="text-[10px] font-black uppercase tracking-[0.14em] text-sky-100/80">Games</div>
                                  <div className="mt-1 text-xl font-black text-white">{activeFormatStats.games}</div>
                                </div>
                                <div className="rounded-2xl bg-white/10 px-3 py-3">
                                  <div className="text-[10px] font-black uppercase tracking-[0.14em] text-sky-100/80">Wins</div>
                                  <div className="mt-1 text-xl font-black text-white">{activeFormatStats.wins}</div>
                                </div>
                                <div className="rounded-2xl bg-white/10 px-3 py-3">
                                  <div className="text-[10px] font-black uppercase tracking-[0.14em] text-sky-100/80">Points</div>
                                  <div className="mt-1 text-xl font-black text-white">{activeFormatStats.points}</div>
                                </div>
                              </div>
                              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-sky-100/80">
                                  {getTournamentFormatTag(alternateFormat).label} On Demand
                                </div>
                                <div className="mt-2 flex items-center justify-between gap-3">
                                  <div className="text-sm font-black text-white">
                                    {alternateFormatStats.wins}W / {alternateFormatStats.games}G
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedProfileFormat(alternateFormat)}
                                    className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white hover:bg-white/20"
                                  >
                                    View {getTournamentFormatTag(alternateFormat).label}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                          );
                        })()}

                        <div className="mt-6">
                          <h3 className="text-sm font-black uppercase tracking-[0.16em] text-fuchsia-100">Recent Verified Tournaments</h3>
                          <div className="mt-3 grid gap-3">
                            {playerProfile.recentClaimedTournaments.map((item) => (
                              <button
                                key={`profile-${item.tournamentId}-${item.playerName}`}
                                type="button"
                                onClick={() => setActiveTournamentId(item.tournamentId)}
                                className="rounded-3xl border-2 border-fuchsia-300/20 bg-[linear-gradient(135deg,rgba(217,70,239,0.16),rgba(56,189,248,0.12))] px-4 py-4 text-left transition-all hover:bg-white/15"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-black uppercase text-white">{item.tournamentName}</span>
                                      <span className="inline-flex items-center gap-1 rounded-md border border-sky-300/40 bg-sky-400/10 px-2 py-0.5 text-[9px] font-black uppercase text-sky-100">
                                        <BadgeCheck className="h-3 w-3" />
                                        {item.playerName}
                                      </span>
                                    </div>
                                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-fuchsia-100/80">
                                      <span>{item.tournamentCode}</span>
                                      <span>•</span>
                                      <span>{getTournamentFormatTag(item.tournamentFormat).label}</span>
                                      <span>•</span>
                                      <span>{item.tournamentStatus}</span>
                                    </div>
                                  </div>
                                  <div className="text-right text-[10px] font-black uppercase tracking-[0.14em] text-fuchsia-100/80">
                                    <div>{item.wins}W / {item.gamesPlayed}G</div>
                                    <div className="mt-1">{item.points} pts</div>
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="mt-6 rounded-2xl border-2 border-dashed border-white/20 bg-white/5 px-4 py-6">
                        <p className="text-sm font-black uppercase text-white">No verified player profile yet.</p>
                        <p className="mt-2 text-xs font-bold text-slate-300">
                          Claim your name or use <span className="font-black uppercase">Add Me</span> in a tournament roster, and your stats will start building here.
                        </p>
                      </div>
                    )}

                    {playerProfileError && (
                      <div className="mt-4 rounded-xl border-2 border-orange-200 bg-orange-50 px-4 py-3 text-sm font-bold text-orange-700">
                        {playerProfileError}
                      </div>
                    )}
                    </div>
                  </div>
                </div>
              )}

              {homeView === 'home' && (
              <div className="grid gap-4 md:grid-cols-[1.05fr_0.95fr] md:gap-5">
                <motion.div 
                  id="create-mixer"
                  whileHover={{ scale: 1.01 }}
                  className="bg-lime-400 border-2 border-slate-800 rounded-2xl p-4 md:p-5 shadow-[3px_3px_0px_0px_rgba(30,41,59,1)] cursor-pointer relative overflow-hidden group"
                  onClick={() => {}}
                >
                  <div className="relative z-10">
                    <div className="w-8 h-8 md:w-10 md:h-10 bg-white border-2 border-slate-800 rounded-lg md:rounded-xl flex items-center justify-center mb-3">
                      <Plus className="w-4 h-4 md:w-6 md:h-6 text-slate-800" />
                    </div>
                    <h2 className="text-xl md:text-2xl font-black text-slate-800 mb-2 uppercase">Create Mixer</h2>
                    <div className="mb-3">
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
                          className={`rounded-xl border-2 px-3 py-3 text-left shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] transition-all hover:translate-y-0.5 active:translate-y-1 active:shadow-none ${
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
                            setNewTournamentPairingMode(DEFAULT_TOURNAMENT_PAIRING_MODE);
                          }}
                          className={`rounded-xl border-2 px-3 py-3 text-left shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] transition-all hover:translate-y-0.5 active:translate-y-1 active:shadow-none ${
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
                    {newTournamentFormat === 'doubles' && (
                      <div className="mb-3 flex items-center gap-2 rounded-xl border-2 border-slate-800 bg-white/45 p-1 shadow-[1.5px_1.5px_0px_0px_rgba(30,41,59,1)]">
                        <span className="px-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-700">
                          Pairs
                        </span>
                        <div className="grid flex-1 grid-cols-2 gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setNewTournamentPairingMode('random');
                              setNewLeagueMode(false);
                            }}
                            className={`flex min-h-9 items-center justify-center gap-1.5 rounded-lg border-2 px-2 text-[10px] font-black uppercase transition-all ${
                              newTournamentPairingMode === 'random'
                                ? 'border-slate-800 bg-lime-400 text-slate-900 shadow-[1.5px_1.5px_0px_0px_rgba(30,41,59,1)]'
                                : 'border-transparent bg-white/50 text-slate-500 hover:bg-white'
                            }`}
                            aria-pressed={newTournamentPairingMode === 'random'}
                            title="Random Pair"
                          >
                            <Shuffle className="h-3.5 w-3.5" />
                            Random
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setNewTournamentPairingMode('fixed');
                            }}
                            className={`flex min-h-9 items-center justify-center gap-1.5 rounded-lg border-2 px-2 text-[10px] font-black uppercase transition-all ${
                              newTournamentPairingMode === 'fixed'
                                ? 'border-slate-800 bg-orange-500 text-white shadow-[1.5px_1.5px_0px_0px_rgba(30,41,59,1)]'
                                : 'border-transparent bg-white/50 text-slate-500 hover:bg-white'
                            }`}
                            aria-pressed={newTournamentPairingMode === 'fixed'}
                            title="Fixed Pair"
                          >
                            <Link2 className="h-3.5 w-3.5" />
                            Fixed
                          </button>
                        </div>
                      </div>
                    )}
                    {newTournamentFormat === 'doubles' && newTournamentPairingMode === 'fixed' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setNewLeagueMode((prev) => !prev);
                        }}
                        className={`mb-3 flex w-full items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition-all ${
                          newLeagueMode
                            ? 'border-slate-800 bg-white shadow-[1.5px_1.5px_0px_0px_rgba(30,41,59,1)]'
                            : 'border-slate-300 bg-white/40 opacity-70'
                        }`}
                        aria-pressed={newLeagueMode}
                      >
                        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 border-slate-800 transition-colors ${newLeagueMode ? 'bg-lime-400' : 'bg-white'}`}>
                          <Repeat2 className="h-3.5 w-3.5 text-slate-800" />
                        </div>
                        <div>
                          <div className="text-[10px] font-black uppercase text-slate-800">League Mode</div>
                          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">
                            Multi-session · Absence tracking · Season standings
                          </div>
                        </div>
                      </button>
                    )}
                    <div className="flex flex-col sm:flex-row items-center gap-2 md:gap-3">
                      <input 
                        type="text" 
                        value={newTourneyName}
                        onChange={(e) => setNewTourneyName(e.target.value)}
                        placeholder={buildSuggestedTournamentName()}
                        onClick={(e) => e.stopPropagation()}
                        className="brutal-input w-full text-sm md:text-base"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setNewTourneyName(buildSuggestedTournamentName());
                        }}
                        className="flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-slate-800 bg-white px-3 text-[10px] font-black uppercase text-slate-700 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] sm:w-auto"
                        title="Suggest a new name"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </button>
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
                  id="join-mixer"
                  whileHover={{ scale: 1.01 }}
                  className="bg-white border-2 border-slate-800 rounded-2xl p-4 shadow-[3px_3px_0px_0px_rgba(163,230,53,1)] group"
                >
                  <div className="flex-1">
                    <div className="w-8 h-8 md:w-12 md:h-12 bg-lime-50 border-2 border-slate-800 rounded-lg md:rounded-xl flex items-center justify-center mb-3 md:mb-6">
                      <Hash className="w-4 h-4 md:w-6 md:h-6 text-slate-400" />
                    </div>
                    <h2 className="text-xl md:text-2xl font-black text-slate-800 mb-2 md:mb-4 uppercase tracking-tight">Join by Code</h2>
                    <div className="flex flex-col sm:flex-row gap-2 md:gap-3">
                      <input 
                        type="text" 
                        inputMode="text"
                        autoComplete="one-time-code"
                        value={joinCode}
                        onChange={(e) => {
                          const value = e.target.value;
                          setJoinCode(getSharedTournamentIdFromInput(value) ? value : normalizeTournamentCodeInput(value));
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && joinByCode()}
                        placeholder="CODE12 or paste link"
                        className="brutal-input flex-1 font-mono tracking-widest text-lg md:text-2xl uppercase text-center sm:text-left"
                      />
                      {typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.readText) && (
                        <button
                          type="button"
                          onClick={pasteJoinCode}
                          className="flex min-h-12 items-center justify-center rounded-xl border-2 border-slate-800 bg-white px-4 text-slate-800 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)]"
                          title="Paste Code or Link"
                        >
                          <ClipboardPaste className="h-5 w-5" />
                        </button>
                      )}
                      <button 
                        onClick={joinByCode}
                        className="brutal-button-lime px-6 md:px-8 text-sm md:text-xl"
                      >
                        JOIN
                      </button>
                    </div>
                    <p className="mt-3 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                      Spaces, dashes, and shared links work too.
                    </p>
                    {error && (
                      <div className="mt-4 bg-orange-50 border-2 border-orange-200 text-orange-600 px-4 py-2 rounded-xl font-bold text-sm uppercase">
                        {error}
                      </div>
                    )}
                  </div>
                </motion.div>
              </div>
              )}

              {homeView === 'activity' && history.length === 0 && (
                <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 text-center">
                  <History className="mx-auto h-10 w-10 text-lime-500" />
                  <h2 className="mt-4 text-lg font-black uppercase text-slate-800">No activity yet</h2>
                  <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                    Create or join a mixer and it will stay here for quick resume.
                  </p>
                  <button
                    type="button"
                    onClick={() => setHomeView('home')}
                    className="mt-5 brutal-button-lime text-xs"
                  >
                    Start from Home
                  </button>
                </div>
              )}

              {(homeView === 'activity' || (homeView === 'home' && history.length > 0)) && history.length > 0 && (
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
        {!isAdminMode && (
          <nav className="fixed inset-x-3 bottom-3 z-50 mx-auto grid max-w-sm grid-cols-3 gap-2 rounded-2xl border-2 border-slate-800 bg-white/95 p-2 shadow-[3px_3px_0px_0px_rgba(30,41,59,1)] backdrop-blur md:hidden">
            {[
              { key: 'home', label: 'Home', icon: Home },
              { key: 'activity', label: 'Active', icon: Activity },
              { key: 'profile', label: 'Profile', icon: BadgeCheck },
            ].map((item) => {
              const Icon = item.icon;
              const isActive = homeView === item.key;
              return (
                <button
                  key={`bottom-${item.key}`}
                  type="button"
                  onClick={() => {
                    setHomeView(item.key as typeof homeView);
                    setIsPlayerProfileOpen(item.key === 'profile');
                  }}
                  className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[9px] font-black uppercase ${
                    isActive ? 'bg-lime-400 text-slate-900' : 'text-slate-500'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        )}
  </div>
</div>
  );
}
