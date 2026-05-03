import React, { useState, useEffect, useRef, useMemo } from 'react';
import QRCode from 'qrcode';
import {
  doc,
  onSnapshot,
  collection,
  query,
  orderBy,
  where,
  updateDoc,
  addDoc,
  serverTimestamp,
  writeBatch,
  Timestamp
} from 'firebase/firestore';
import {
  db,
  auth,
  Tournament,
  TournamentFormat,
  TournamentPairingMode,
  Player,
  Match,
  Session,
  SessionAbsence,
  getReadableFirestoreError
} from '../lib/firebase';
import {
  buildSeededPlayoffMatches,
  buildSessionAdjustmentPlan,
  buildSessionName,
  filterMatchesBySession,
  generateRoundMatches,
  getFixedPairingStatus,
  getFixedPairStandings,
  getMinimumPlayers,
  getSittingOutPlayerIds,
  getTournamentFormat,
  getTournamentFormatTag,
  getTournamentPairingMode,
  type SeededPlayoffPair
} from '../lib/tournamentLogic';
import {
  Trophy,
  Users,
  Plus,
  Share2,
  ChevronLeft,
  RotateCcw,
  AlertTriangle,
  Loader2,
  Flag,
  Bell,
  X,
  Copy,
  CheckCircle2,
  CalendarDays,
  UserMinus
} from 'lucide-react';
import Leaderboard from './Leaderboard';
import MatchList from './MatchList';
import PlayerManager from './PlayerManager';
import SessionManager from './SessionManager';
import { motion, AnimatePresence } from 'motion/react';
import { buildJoinUrl, buildSpectatorUrl } from '../lib/appUrl';

interface Props {
  tournamentId: string;
  readOnly?: boolean;
  onBack: () => void;
}

interface ScoreNotification {
  id: string;
  matchId: string;
  tournamentName: string;
  round: number;
  roundLabel?: string;
  team1Label: string;
  team2Label: string;
  score1: number;
  score2: number;
  previousScore1?: number | null;
  previousScore2?: number | null;
  action: 'entered' | 'modified';
  actorUserId?: string | null;
  actorDisplayName?: string;
  recipientUserIds: string[];
  createdAt?: Timestamp;
}

function TournamentStatusPill({ status, readOnly }: { status?: Tournament['status']; readOnly: boolean }) {
  const label = readOnly ? 'spectator' : (status || 'setup');
  const styles = label === 'active'
    ? 'border-lime-300 bg-lime-100 text-lime-800'
    : label === 'completed'
      ? 'border-slate-300 bg-slate-100 text-slate-700'
      : label === 'spectator'
        ? 'border-sky-300 bg-sky-100 text-sky-800'
        : 'border-orange-300 bg-orange-100 text-orange-800';

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[8px] font-black uppercase tracking-[0.14em] ${styles}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

export default function TournamentDashboard({ tournamentId, readOnly = false, onBack }: Props) {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [tab, setTab] = useState<'matches' | 'leaderboard' | 'setup'>('matches');
  const [loading, setLoading] = useState(true);
  const [roundActionError, setRoundActionError] = useState<string | null>(null);
  const [playoffActionError, setPlayoffActionError] = useState<string | null>(null);
  const [isGeneratingRound, setIsGeneratingRound] = useState(false);
  const [isCreatingPlayoffRound, setIsCreatingPlayoffRound] = useState(false);
  const [isTournamentMember, setIsTournamentMember] = useState(false);
  const [scoreNotifications, setScoreNotifications] = useState<ScoreNotification[]>([]);
  const [isJoinPanelOpen, setIsJoinPanelOpen] = useState(false);
  const [joinQrDataUrl, setJoinQrDataUrl] = useState('');
  const [joinLinkCopied, setJoinLinkCopied] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isSessionManagerOpen, setIsSessionManagerOpen] = useState(false);
  const [sessionManagerMode, setSessionManagerMode] = useState<'new' | 'adjust'>('new');
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  const uniqueOpponents = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    players.forEach(p => { map[p.id] = new Set(); });
    matches.filter(m => m.status === 'completed').forEach(m => {
      m.team1.forEach(p1 => m.team2.forEach(p2 => {
        map[p1]?.add(p2);
        map[p2]?.add(p1);
      }));
    });
    return map;
  }, [matches, players]);
  const [isStartingSession, setIsStartingSession] = useState(false);

  useEffect(() => {
    const unsubT = onSnapshot(doc(db, 'tournaments', tournamentId), (s) => {
      if (s.exists()) {
        setTournament({ id: s.id, ...s.data() } as Tournament);
        if (s.data().status === 'setup') {
          setTab(readOnly ? 'matches' : 'setup');
        }
      }
      setLoading(false);
    }, (err) => {
      console.error('Tournament listener error:', err);
      setLoading(false);
    });

    const unsubP = onSnapshot(collection(db, 'tournaments', tournamentId, 'players'), (s) => {
      setPlayers(s.docs.map(d => ({ id: d.id, ...d.data() } as Player)));
    }, (err) => {
      console.error('Players listener error:', err);
    });

    const unsubM = onSnapshot(
      query(collection(db, 'tournaments', tournamentId, 'matches'), orderBy('round', 'desc'), orderBy('updatedAt', 'desc')),
      (s) => {
        setMatches(s.docs.map(d => ({ id: d.id, ...d.data() } as Match)));
      },
      (err) => {
        console.error('Matches listener error:', err);
      }
    );

    const unsubS = onSnapshot(
      query(collection(db, 'tournaments', tournamentId, 'sessions'), orderBy('createdAt')),
      (s) => setSessions(s.docs.map((d) => ({ id: d.id, ...d.data() } as Session))),
      (err) => console.error('Sessions listener error:', err)
    );

    return () => { unsubT(); unsubP(); unsubM(); unsubS(); };
  }, [readOnly, tournamentId]);

  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser || readOnly) {
      setIsTournamentMember(false);
      return;
    }

    if (tournament?.ownerId === currentUser.uid) {
      setIsTournamentMember(true);
      return;
    }

    return onSnapshot(doc(db, 'users', currentUser.uid, 'tournaments', tournamentId), (snapshot) => {
      setIsTournamentMember(snapshot.exists());
    }, () => {
      setIsTournamentMember(false);
    });
  }, [readOnly, tournamentId, tournament?.ownerId]);

  const isOwner = tournament?.ownerId === auth.currentUser?.uid;
  const currentUserId = auth.currentUser?.uid;
  const hasClaimedPlayer = Boolean(currentUserId && players.some((player) => player.claimedByUserId === currentUserId));
  const canManageTournament = isOwner && !readOnly;
  const canEnterScores = !readOnly && (isOwner || hasClaimedPlayer);
  const canContributePlayers = !readOnly && (isOwner || isTournamentMember);
  const showSetupTab = !readOnly && (isOwner || isTournamentMember);
  const tournamentFormat: TournamentFormat = getTournamentFormat(tournament?.format);
  const tournamentPairingMode: TournamentPairingMode = getTournamentPairingMode(tournament?.pairingMode, tournamentFormat);
  const tournamentFormatTag = getTournamentFormatTag(tournamentFormat);
  const minimumPlayers = getMinimumPlayers(tournamentFormat);
  const fixedPairingStatus = getFixedPairingStatus(players);
  const playoffStarted = matches.some((match) => match.stage === 'playoff');
  const currentRound = matches.length > 0 ? Math.max(...matches.map((match) => match.round)) : 0;
  const currentRoundMatches = matches.filter((match) => match.round === currentRound && match.status !== 'void');
  const gamesLeftInRound = currentRoundMatches.filter((match) => match.status === 'pending').length;
  const canCloseTournament = canManageTournament && tournament?.status === 'active' && matches.length > 0 && gamesLeftInRound === 0;
  const joinUrl = typeof window !== 'undefined' ? buildJoinUrl(window.location.origin, tournamentId) : '';
  const currentSession = sessions.find((s) => s.status === 'active') ?? sessions[sessions.length - 1] ?? null;
  const currentSessionAbsences = currentSession?.absences ?? {};
  const canStartNewSession = canManageTournament && tournament?.status === 'active' && !playoffStarted && gamesLeftInRound === 0 && currentRound > 0;
  const canAdjustCurrentSession = canManageTournament && tournament?.status === 'active' && !playoffStarted && currentSession?.status === 'active' && gamesLeftInRound > 0 && currentRound >= currentSession.startRound;
  const canGenerateNextRound = canManageTournament && tournament?.status === 'active' && !playoffStarted && matches.length > 0 && gamesLeftInRound === 0;

  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser || readOnly || !hasClaimedPlayer) {
      setScoreNotifications([]);
      return;
    }

    let didLoadInitialSnapshot = false;
    const notificationsQuery = query(
      collection(db, 'tournaments', tournamentId, 'scoreNotifications'),
      where('recipientUserIds', 'array-contains', currentUser.uid)
    );

    return onSnapshot(notificationsQuery, (snapshot) => {
      if (!didLoadInitialSnapshot) {
        didLoadInitialSnapshot = true;
        return;
      }

      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added') return;

        const notification = { id: change.doc.id, ...change.doc.data() } as ScoreNotification;
        if (notification.actorUserId === currentUser.uid) return;

        setScoreNotifications((prev) => [notification, ...prev].slice(0, 3));
        window.setTimeout(() => {
          setScoreNotifications((prev) => prev.filter((item) => item.id !== notification.id));
        }, 6500);

        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
          const scoreLine = `${notification.team1Label} ${notification.score1}-${notification.score2} ${notification.team2Label}`;
          new Notification(`${notification.tournamentName || 'Dinkly'} score ${notification.action}`, {
            body: `${notification.roundLabel || `RD ${notification.round}`}: ${scoreLine}`,
            tag: `dinkly-score-${tournamentId}-${notification.matchId}`,
            icon: '/icons/icon-192.png',
          });
        }
      });
    }, (err) => {
      console.error('Score notification listener error:', err);
    });
  }, [hasClaimedPlayer, readOnly, tournamentId]);

  useEffect(() => {
    if (!isJoinPanelOpen || !joinUrl) return;

    let cancelled = false;
    void QRCode.toDataURL(joinUrl, {
      margin: 1,
      width: 224,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    }).then((dataUrl) => {
      if (!cancelled) {
        setJoinQrDataUrl(dataUrl);
      }
    }).catch((error) => {
      console.error('QR generation failed:', error);
      if (!cancelled) {
        setJoinQrDataUrl('');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isJoinPanelOpen, joinUrl]);

  const startTournament = async () => {
    if (!canManageTournament) return;
    setRoundActionError(null);
    if (players.length < minimumPlayers) {
      return alert(`Need at least ${minimumPlayers} players for a ${tournamentFormat} tournament!`);
    }
    if (tournamentPairingMode === 'fixed' && fixedPairingStatus.issue) {
      setRoundActionError(fixedPairingStatus.issue);
      setTab('setup');
      return;
    }
    try {
      await updateDoc(doc(db, 'tournaments', tournamentId), { status: 'active' });
      setTab('matches');
      await addDoc(collection(db, 'tournaments', tournamentId, 'sessions'), {
        name: buildSessionName(1),
        startRound: 1,
        status: 'active',
        absences: {},
        createdAt: serverTimestamp(),
      });
      await generateNextRound({});
    } catch (e) {
      const message = getReadableFirestoreError(e, 'Unable to start the tournament right now.');
      setRoundActionError(message);
    }
  };

  const generateNextRound = async (overrideAbsences?: Record<string, SessionAbsence>) => {
    if (!canManageTournament) return;
    setRoundActionError(null);
    setIsGeneratingRound(true);

    try {
      if (playoffStarted) {
        setRoundActionError('Playoffs have started. Create knockout rounds from Rankings.');
        setTab('leaderboard');
        return;
      }
      if (players.length < minimumPlayers) {
        setRoundActionError(`You need at least ${minimumPlayers} players for a ${tournamentFormat} round.`);
        return;
      }
      if (tournamentPairingMode === 'fixed' && fixedPairingStatus.issue) {
        setRoundActionError(fixedPairingStatus.issue);
        setTab('setup');
        return;
      }

      const absences = overrideAbsences ?? (currentSession ? currentSessionAbsences : {});
      const sittingOutIds = new Set(
        Object.keys(absences).length > 0 ? getSittingOutPlayerIds(players, absences) : []
      );
      const activePlayers = sittingOutIds.size > 0
        ? players.filter((p) => !sittingOutIds.has(p.id))
        : players;

      if (activePlayers.length < minimumPlayers) {
        setRoundActionError(`Not enough active players after absences. Need at least ${minimumPlayers}.`);
        return;
      }

      const currentRound = matches.length > 0 ? Math.max(...matches.map((m) => m.round)) : 0;
      const nextRound = currentRound + 1;
      const roundMatches = generateRoundMatches(activePlayers, nextRound, tournamentFormat, matches, tournamentPairingMode);

      if (roundMatches.length === 0) {
        setRoundActionError(`No ${tournamentFormat} matches could be generated from the current roster.`);
        return;
      }

      const batch = writeBatch(db);
      roundMatches.forEach((m) => {
        const ref = doc(collection(db, 'tournaments', tournamentId, 'matches'));
        batch.set(ref, {
          ...m,
          updatedAt: serverTimestamp(),
          completedAt: null,
          voidedAt: null,
          statusBeforeVoid: null,
          previousScore1: null,
          previousScore2: null,
          previousCompletedAt: null,
        });
      });
      await batch.commit();
    } catch (e) {
      console.error('Round generation failed:', e);
      const message = getReadableFirestoreError(e, 'Unable to generate the next round right now.');
      setRoundActionError(message);
    } finally {
      setIsGeneratingRound(false);
    }
  };

  const startNewSession = async (name: string, absences: Record<string, SessionAbsence>) => {
    if (!canManageTournament) return;
    setIsStartingSession(true);
    setRoundActionError(null);

    try {
      if (currentSession?.status === 'active') {
        await updateDoc(doc(db, 'tournaments', tournamentId, 'sessions', currentSession.id), {
          status: 'completed',
          endRound: currentRound,
        });
      }

      await addDoc(collection(db, 'tournaments', tournamentId, 'sessions'), {
        name,
        startRound: currentRound + 1,
        status: 'active',
        absences,
        createdAt: serverTimestamp(),
      });

      await generateNextRound(absences);
      setIsSessionManagerOpen(false);
    } catch (e) {
      console.error('Session start failed:', e);
      const message = getReadableFirestoreError(e, 'Unable to start the session right now.');
      setRoundActionError(message);
    } finally {
      setIsStartingSession(false);
    }
  };

  const adjustCurrentSession = async (name: string, absences: Record<string, SessionAbsence>) => {
    if (!canManageTournament || !currentSession) return;
    setIsStartingSession(true);
    setRoundActionError(null);

    try {
      if (playoffStarted) {
        setRoundActionError('Playoffs have started. Session adjustments are disabled.');
        return;
      }

      const adjustmentPlan = buildSessionAdjustmentPlan(
        players,
        matches,
        currentRound,
        tournamentFormat,
        tournamentPairingMode,
        absences
      );
      const pendingCurrentRoundMatches = adjustmentPlan.pendingMatchesToVoid;
      if (pendingCurrentRoundMatches.length === 0) {
        await updateDoc(doc(db, 'tournaments', tournamentId, 'sessions', currentSession.id), {
          name,
          absences,
          updatedAt: serverTimestamp(),
        });
        setIsSessionManagerOpen(false);
        return;
      }

      const batch = writeBatch(db);
      batch.update(doc(db, 'tournaments', tournamentId, 'sessions', currentSession.id), {
        name,
        absences,
        updatedAt: serverTimestamp(),
      });

      pendingCurrentRoundMatches.forEach((match) => {
        batch.update(doc(db, 'tournaments', tournamentId, 'matches', match.id), {
          score1: 0,
          score2: 0,
          status: 'void',
          updatedAt: serverTimestamp(),
          completedAt: null,
          voidedAt: serverTimestamp(),
          statusBeforeVoid: match.status,
          previousScore1: match.score1,
          previousScore2: match.score2,
          previousCompletedAt: match.completedAt ?? null,
        });
      });

      adjustmentPlan.replacementMatches.forEach((match) => {
        const ref = doc(collection(db, 'tournaments', tournamentId, 'matches'));
        batch.set(ref, {
          ...match,
          updatedAt: serverTimestamp(),
          completedAt: null,
          voidedAt: null,
          statusBeforeVoid: null,
          previousScore1: null,
          previousScore2: null,
          previousCompletedAt: null,
        });
      });

      await batch.commit();
      setIsSessionManagerOpen(false);

      if (adjustmentPlan.replacementMatches.length === 0) {
        setRoundActionError('Session updated. Pending games were voided, but there are not enough remaining players for replacement games.');
      }
    } catch (e) {
      console.error('Session adjustment failed:', e);
      const message = getReadableFirestoreError(e, 'Unable to adjust the session right now.');
      setRoundActionError(message);
    } finally {
      setIsStartingSession(false);
    }
  };

  const setMatchDocs = async (roundMatches: Partial<Match>[]) => {
    const batch = writeBatch(db);
    roundMatches.forEach((m) => {
      const ref = doc(collection(db, 'tournaments', tournamentId, 'matches'));
      batch.set(ref, {
        ...m,
        updatedAt: serverTimestamp(),
        completedAt: null,
        voidedAt: null,
        statusBeforeVoid: null,
        previousScore1: null,
        previousScore2: null,
        previousCompletedAt: null,
      });
    });
    await batch.commit();
  };

  const getFixedPairForTeam = (team: string[]): SeededPlayoffPair | null => {
    const teamPairIds = Array.from(new Set(
      team
        .map((playerId) => players.find((player) => player.id === playerId)?.fixedPairId)
        .filter((pairId): pairId is string => Boolean(pairId))
    ));

    if (teamPairIds.length !== 1) return null;

    const pairPlayers = players.filter((player) => player.fixedPairId === teamPairIds[0]);
    if (pairPlayers.length !== 2) return null;

    return {
      id: teamPairIds[0],
      playerIds: pairPlayers.map((player) => player.id),
      label: pairPlayers.map((player) => player.name).join(' & '),
      seed: 0,
    };
  };

  const getWinningPlayoffPair = (match: Match): SeededPlayoffPair | null => {
    if (match.status !== 'completed' || match.score1 === match.score2) return null;

    const winnerTeam = match.score1 > match.score2 ? 1 : 2;
    const pair = getFixedPairForTeam(winnerTeam === 1 ? match.team1 : match.team2);
    if (!pair) return null;

    const fallbackSeed = getFixedPairStandings(players, matches, 'preliminary')
      .find((standing) => standing.id === pair.id)?.seed ?? Number.MAX_SAFE_INTEGER;

    return {
      ...pair,
      seed: winnerTeam === 1 ? (match.seed1 ?? fallbackSeed) : (match.seed2 ?? fallbackSeed),
    };
  };

  const createInitialPlayoffRound = async (pairIds: string[]) => {
    if (!canManageTournament) return;

    setPlayoffActionError(null);
    setRoundActionError(null);
    setIsCreatingPlayoffRound(true);

    try {
      if (tournamentFormat !== 'doubles' || tournamentPairingMode !== 'fixed') {
        setPlayoffActionError('Playoffs are only available for fixed-pair doubles tournaments.');
        return;
      }
      if (tournament?.status !== 'active') {
        setPlayoffActionError('Start the tournament before creating playoffs.');
        return;
      }
      if (playoffStarted) {
        setPlayoffActionError('Playoffs have already started for this tournament.');
        return;
      }
      if (pairIds.length < 2) {
        setPlayoffActionError('Select at least 2 pairs for the playoff.');
        return;
      }
      if (pairIds.length % 2 !== 0) {
        setPlayoffActionError('Select an even number of pairs before creating playoffs.');
        return;
      }
      const selectedPairIds = new Set(pairIds);
      const preliminaryStandings = getFixedPairStandings(players, matches, 'preliminary');
      const seededPairs = preliminaryStandings
        .filter((standing) => selectedPairIds.has(standing.id))
        .map((standing) => ({
          id: standing.id,
          playerIds: standing.playerIds,
          label: standing.label,
          seed: standing.seed,
        }));

      if (seededPairs.length !== pairIds.length) {
        setPlayoffActionError('One or more selected pairs are no longer available. Refresh the selection and try again.');
        return;
      }

      const nextRound = currentRound + 1;
      const roundMatches = buildSeededPlayoffMatches(seededPairs, nextRound, 1);
      if (roundMatches.length === 0) {
        setPlayoffActionError('No playoff games could be created from the selected pairs.');
        return;
      }

      await setMatchDocs(roundMatches);
      setTab('matches');
    } catch (e) {
      console.error('Playoff creation failed:', e);
      const message = getReadableFirestoreError(e, 'Unable to create the playoff round right now.');
      setPlayoffActionError(message);
    } finally {
      setIsCreatingPlayoffRound(false);
    }
  };

  const createNextPlayoffRound = async () => {
    if (!canManageTournament) return;

    setPlayoffActionError(null);
    setRoundActionError(null);
    setIsCreatingPlayoffRound(true);

    try {
      if (tournamentFormat !== 'doubles' || tournamentPairingMode !== 'fixed') {
        setPlayoffActionError('Playoffs are only available for fixed-pair doubles tournaments.');
        return;
      }

      const playoffMatches = matches.filter((match) => match.stage === 'playoff');
      if (playoffMatches.length === 0) {
        setPlayoffActionError('Create the first playoff round before advancing.');
        return;
      }

      const currentPlayoffRound = Math.max(...playoffMatches.map((match) => match.playoffRound ?? 1));
      const currentPlayoffMatches = playoffMatches.filter((match) => (
        (match.playoffRound ?? 1) === currentPlayoffRound
      ));

      if (currentPlayoffMatches.some((match) => match.status !== 'completed')) {
        setPlayoffActionError('Finish all games in the current playoff round first.');
        return;
      }

      const winners = currentPlayoffMatches
        .map(getWinningPlayoffPair)
        .filter((pair): pair is SeededPlayoffPair => Boolean(pair))
        .sort((left, right) => left.seed - right.seed);

      if (winners.length < 2) {
        setPlayoffActionError('Playoff is complete.');
        return;
      }

      if (winners.length % 2 !== 0) {
        setPlayoffActionError('An odd number of playoff winners is available. Resolve the current round before continuing.');
        return;
      }

      const nextRound = currentRound + 1;
      const roundMatches = buildSeededPlayoffMatches(winners, nextRound, currentPlayoffRound + 1);
      if (roundMatches.length === 0) {
        setPlayoffActionError('No next playoff games could be created.');
        return;
      }

      await setMatchDocs(roundMatches);
      setTab('matches');
    } catch (e) {
      console.error('Next playoff round failed:', e);
      const message = getReadableFirestoreError(e, 'Unable to create the next playoff round right now.');
      setPlayoffActionError(message);
    } finally {
      setIsCreatingPlayoffRound(false);
    }
  };

  const completeTournament = async () => {
    if (!canCloseTournament) return;
    if (!window.confirm('Close this tournament now? This will mark it completed and freeze round generation.')) return;

    setRoundActionError(null);
    try {
      await updateDoc(doc(db, 'tournaments', tournamentId), {
        status: 'completed',
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      const message = getReadableFirestoreError(e, 'Unable to close the tournament right now.');
      setRoundActionError(message);
    }
  };

  const shareJoinLink = async () => {
    if (navigator.share) {
      await navigator.share({
        title: '🏓 Let\'s play Pickleball on Dinkly!',
        text: `Ready to dink? Join "${tournament?.name}" on Dinkly. This link opens the tournament directly, so you can claim your player and track scores. 🔥`,
        url: joinUrl
      });
    } else {
      await copyJoinLink();
    }
  };

  const copyJoinLink = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setJoinLinkCopied(true);
      window.setTimeout(() => setJoinLinkCopied(false), 1800);
    } catch {
      alert(joinUrl);
    }
  };

  if (loading) return null;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'linear-gradient(160deg, #f7fee7 0%, #fefce8 60%, #f0fdf4 100%)' }}>
      <div className="pointer-events-none fixed right-3 top-3 z-[220] flex w-[min(360px,calc(100vw-24px))] flex-col gap-2">
        <AnimatePresence>
          {scoreNotifications.map((notification) => (
            <motion.div
              key={notification.id}
              initial={{ opacity: 0, x: 80, scale: 0.92 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.9, transition: { duration: 0.18 } }}
              className="pointer-events-auto rounded-2xl border-2 border-slate-800 bg-white p-3 shadow-[4px_4px_0px_0px_rgba(30,41,59,1)]"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-slate-800 bg-lime-400">
                  <Bell className="h-5 w-5 text-slate-900" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-lime-700">
                    Score {notification.action}
                  </div>
                  <div className="mt-1 truncate text-sm font-black uppercase text-slate-900">
                    {notification.team1Label} {notification.score1}-{notification.score2} {notification.team2Label}
                  </div>
                  <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                    {notification.roundLabel || `RD ${notification.round}`}
                    {notification.actorDisplayName ? ` by ${notification.actorDisplayName}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setScoreNotifications((prev) => prev.filter((item) => item.id !== notification.id))}
                  className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  title="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <header className="bg-slate-900 border-b-[3px] border-slate-700 px-3 py-2.5 md:px-5 md:py-3 sticky top-0 z-50 backdrop-blur">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 md:gap-4 min-w-0">
            <button onClick={onBack} className="shrink-0 p-1.5 md:p-2 border-2 border-slate-600 rounded-lg md:rounded-xl bg-slate-800 hover:bg-slate-700 text-white transition-colors">
              <ChevronLeft className="w-4 h-4 md:w-5 md:h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-base md:text-xl font-black text-white tracking-tight leading-none uppercase truncate max-w-[160px] sm:max-w-xs md:max-w-none">{tournament?.name}</h1>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <button
                  onClick={() => setIsCodeModalOpen(true)}
                  className="font-mono text-[10px] font-black text-lime-400 bg-slate-800 border border-slate-600 px-1.5 py-0.5 rounded-md hover:bg-slate-700 hover:border-lime-500 hover:text-lime-300 transition-colors cursor-pointer"
                  title="Show join code"
                >
                  {tournament?.code}
                </button>
                <TournamentStatusPill status={tournament?.status} readOnly={readOnly} />
                <span className="inline-flex items-center gap-1 rounded-full border border-orange-700/50 bg-orange-500/20 px-2 py-0.5 text-[8px] font-black uppercase text-orange-300">
                  <span>{tournamentFormatTag.label}</span>
                  <span className="text-orange-500">·</span>
                  <span>{tournamentFormatTag.detail}</span>
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setIsJoinPanelOpen(true)}
            className="shrink-0 flex items-center gap-1.5 bg-orange-500 text-white rounded-xl border-2 border-slate-800 shadow-[2px_2px_0px_0px_rgba(194,65,12,1)] hover:-translate-y-0.5 hover:shadow-[3px_3px_0px_0px_rgba(194,65,12,1)] active:translate-y-0.5 active:shadow-none transition-all duration-150 px-3 py-2 text-[10px] font-black uppercase"
            title="Invite Players"
          >
            <Share2 className="w-3.5 h-3.5 md:w-4 md:h-4" />
            <span className="hidden sm:inline">Invite</span>
          </button>
        </div>
      </header>

      <AnimatePresence>
        {isCodeModalOpen && (
          <motion.div
            className="fixed inset-0 z-[270] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsCodeModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.85, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 8 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-sm rounded-3xl border-4 border-slate-800 bg-slate-900 p-8 text-center shadow-[8px_8px_0px_0px_rgba(163,230,53,0.4)]"
            >
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-500 mb-1">Join Code</p>
              <h2 className="text-lg font-black uppercase tracking-tight text-slate-300 truncate mb-6">{tournament?.name}</h2>
              <div className="rounded-2xl border-2 border-slate-700 bg-slate-800 px-6 py-8 mb-6">
                <span className="font-mono text-5xl sm:text-6xl font-black tracking-[0.2em] text-lime-400 select-all break-all">
                  {tournament?.code}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(tournament?.code ?? '');
                    setCodeCopied(true);
                    setTimeout(() => setCodeCopied(false), 2000);
                  }}
                  className="min-h-12 rounded-2xl border-2 border-slate-700 bg-slate-800 px-4 text-[11px] font-black uppercase text-white hover:bg-slate-700 transition-colors flex items-center justify-center gap-2"
                >
                  {codeCopied ? <CheckCircle2 className="h-4 w-4 text-lime-400" /> : <Copy className="h-4 w-4" />}
                  {codeCopied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={() => setIsCodeModalOpen(false)}
                  className="min-h-12 rounded-2xl border-2 border-slate-600 bg-slate-800 px-4 text-[11px] font-black uppercase text-slate-400 hover:bg-slate-700 transition-colors"
                >
                  Close
                </button>
              </div>
              <p className="mt-4 text-[10px] font-bold text-slate-600 uppercase tracking-widest">tap outside to dismiss</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isJoinPanelOpen && (
          <motion.div
            className="fixed inset-0 z-[260] flex items-end justify-center bg-slate-950/45 p-3 backdrop-blur-sm sm:items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsJoinPanelOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 360, damping: 28 }}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-sm rounded-3xl border-4 border-slate-900 bg-white p-4 shadow-[8px_8px_0px_0px_rgba(30,41,59,1)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-lime-700">
                    Join Tournament
                  </div>
                  <h2 className="mt-1 text-xl font-black uppercase leading-tight text-slate-900">
                    {tournament?.name}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIsJoinPanelOpen(false)}
                  className="rounded-xl border-2 border-slate-800 bg-white p-2 text-slate-500 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] hover:text-slate-900"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 rounded-2xl border-2 border-slate-800 bg-lime-50 p-3">
                <div className="flex items-center justify-center rounded-xl border-2 border-slate-800 bg-white p-3">
                  {joinQrDataUrl ? (
                    <img src={joinQrDataUrl} alt="Join tournament QR code" className="h-48 w-48" />
                  ) : (
                    <div className="flex h-48 w-48 items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-lime-600" />
                    </div>
                  )}
                </div>
                <p className="mt-3 text-center text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                  Scan or share. No code typing.
                </p>
              </div>

              <div className="mt-4 rounded-2xl border-2 border-slate-200 bg-slate-50 px-3 py-2">
                <div className="truncate font-mono text-[11px] font-bold text-slate-600">
                  {joinUrl}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={copyJoinLink}
                  className="min-h-12 rounded-xl border-2 border-slate-800 bg-white px-3 text-[10px] font-black uppercase text-slate-800 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)]"
                >
                  <span className="inline-flex items-center justify-center gap-2">
                    {joinLinkCopied ? <CheckCircle2 className="h-4 w-4 text-lime-600" /> : <Copy className="h-4 w-4" />}
                    {joinLinkCopied ? 'Copied' : 'Copy'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={shareJoinLink}
                  className="min-h-12 rounded-xl border-2 border-slate-800 bg-orange-500 px-3 text-[10px] font-black uppercase text-white shadow-[2px_2px_0px_0px_rgba(30,41,59,1)]"
                >
                  <span className="inline-flex items-center justify-center gap-2">
                    <Share2 className="h-4 w-4" />
                    Share
                  </span>
                </button>
              </div>

              <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-center text-[10px] font-black uppercase tracking-[0.12em] text-orange-700">
                Backup code: <span className="font-mono">{tournament?.code}</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isSessionManagerOpen && (
          <SessionManager
            players={players}
            sessionNumber={sessionManagerMode === 'adjust' && currentSession ? sessions.findIndex((session) => session.id === currentSession.id) + 1 : sessions.length + 1}
            format={tournamentFormat}
            pairingMode={tournamentPairingMode}
            initialName={sessionManagerMode === 'adjust' ? currentSession?.name : undefined}
            initialAbsences={sessionManagerMode === 'adjust' ? currentSessionAbsences : undefined}
            heading={sessionManagerMode === 'adjust' ? "Who's Out?" : undefined}
            actionLabel={sessionManagerMode === 'adjust' ? 'Apply Changes' : 'Start Session'}
            allowBelowMinimum={sessionManagerMode === 'adjust'}
            isCreating={isStartingSession}
            onConfirm={sessionManagerMode === 'adjust' ? adjustCurrentSession : startNewSession}
            onCancel={() => setIsSessionManagerOpen(false)}
          />
        )}
      </AnimatePresence>

      <nav className="bg-slate-900 border-b-2 border-slate-700 px-2 md:px-4 overflow-x-auto no-scrollbar">
        <div className="max-w-4xl mx-auto flex items-center justify-between min-w-max">
          <div className="flex">
            <TabButton active={tab === 'matches'} onClick={() => setTab('matches')} icon={<RotateCcw className="w-3.5 h-3.5 md:w-4 md:h-4" />} label="GAMES" />
            <TabButton active={tab === 'leaderboard'} onClick={() => setTab('leaderboard')} icon={<Trophy className="w-3.5 h-3.5 md:w-4 md:h-4" />} label="RANKINGS" />
            {showSetupTab && (
              <TabButton active={tab === 'setup'} onClick={() => setTab('setup')} icon={<Users className="w-3.5 h-3.5 md:w-4 md:h-4" />} label="PLAYERS" />
            )}
          </div>
          <div className="flex items-center gap-1 pr-3 md:hidden">
            {(['matches', 'leaderboard', ...(showSetupTab ? ['setup'] : [])] as const).map(t => (
              <button key={t} onClick={() => setTab(t as typeof tab)} className={`h-1.5 rounded-full transition-all duration-200 ${tab === t ? 'w-4 bg-lime-400' : 'w-1.5 bg-slate-600'}`} />
            ))}
          </div>
        </div>
      </nav>

      <main
        className="flex-1 p-3 md:p-8 max-w-4xl mx-auto w-full"
        onTouchStart={e => {
          touchStartX.current = e.touches[0].clientX;
          touchStartY.current = e.touches[0].clientY;
        }}
        onTouchEnd={e => {
          const dx = e.changedTouches[0].clientX - touchStartX.current;
          const dy = e.changedTouches[0].clientY - touchStartY.current;
          if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
          const tabs = (['matches', 'leaderboard', ...(showSetupTab ? ['setup'] : [])] as const);
          const idx = tabs.indexOf(tab as typeof tabs[number]);
          if (dx < 0 && idx < tabs.length - 1) setTab(tabs[idx + 1] as typeof tab);
          else if (dx > 0 && idx > 0) setTab(tabs[idx - 1] as typeof tab);
        }}
      >
        <AnimatePresence mode="wait">
          {tab === 'setup' && (
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
              <PlayerManager
                tournamentId={tournamentId}
                players={players}
                matches={matches}
                format={tournamentFormat}
                pairingMode={tournamentPairingMode}
                canAddPlayers={canContributePlayers}
                isOwner={canManageTournament}
                status={tournament?.status || 'setup'}
                onStart={startTournament}
              />
            </motion.div>
          )}

          {tab === 'matches' && (
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
              <div className="mb-6 space-y-3 md:mb-8">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-black text-slate-800 md:text-3xl">COURT TRACKER</h2>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      {currentSession && <span>{currentSession.name}</span>}
                      {gamesLeftInRound > 0 ? (
                        <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-orange-700">
                          {gamesLeftInRound} left in round {currentRound}
                        </span>
                      ) : currentRound > 0 && tournament?.status === 'active' && !playoffStarted ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-lime-300 bg-lime-50 px-2 py-0.5 text-lime-700">
                          <CheckCircle2 className="h-3 w-3" /> Round {currentRound} complete
                        </span>
                      ) : null}
                      {(() => {
                        if (players.length < 2 || currentRound === 0) return null;
                        const total = players.length * (players.length - 1);
                        const covered = players.reduce((sum, p) => sum + (uniqueOpponents[p.id]?.size ?? 0), 0);
                        const pct = total > 0 ? Math.round((covered / total) * 100) : 0;
                        if (pct === 0) return null;
                        return (
                          <span className={`rounded-full border px-2 py-0.5 ${pct === 100 ? 'border-lime-300 bg-lime-50 text-lime-700' : 'border-slate-200 bg-white text-slate-500'}`}>
                            {pct === 100 ? '🎯 all-play' : `${pct}% matchup coverage`}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                  {canGenerateNextRound && (
                    <button
                      onClick={() => generateNextRound()}
                      disabled={isGeneratingRound}
                      className="brutal-button-lime shrink-0 px-3 py-2 md:px-6 md:py-3"
                    >
                      <div className="flex items-center gap-1.5 md:gap-2">
                        {isGeneratingRound ? <Loader2 className="h-4 w-4 animate-spin md:h-5 md:w-5" /> : <Plus className="h-4 w-4 md:h-5 md:w-5" />}
                        <span className="text-xs sm:text-sm">{isGeneratingRound ? 'BUILDING...' : 'NEXT ROUND'}</span>
                      </div>
                    </button>
                  )}
                </div>

                {(canAdjustCurrentSession || canStartNewSession || canCloseTournament) && (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border-2 border-slate-200 bg-white/70 p-2">
                  {canAdjustCurrentSession && (
                    <button
                      onClick={() => {
                        setSessionManagerMode('adjust');
                        setIsSessionManagerOpen(true);
                      }}
                      disabled={isGeneratingRound || isStartingSession}
                      className="min-h-10 rounded-xl border-2 border-slate-800 bg-orange-50 px-3 py-2 text-[10px] font-black uppercase text-slate-800 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)]"
                      title="Mark players out or add substitutes for this round"
                    >
                      <span className="inline-flex items-center gap-2">
                        <UserMinus className="h-3.5 w-3.5" />
                        Mark Player Out
                      </span>
                    </button>
                  )}
                  {canStartNewSession && (
                    <button
                      onClick={() => {
                        setSessionManagerMode('new');
                        setIsSessionManagerOpen(true);
                      }}
                      disabled={isGeneratingRound || isStartingSession}
                      className="min-h-10 rounded-xl border-2 border-slate-800 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-800 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)]"
                    >
                      <span className="inline-flex items-center gap-2">
                        <CalendarDays className="h-3.5 w-3.5" />
                        New Session
                      </span>
                    </button>
                  )}
                  {canCloseTournament && (
                    <button
                      onClick={completeTournament}
                      className="min-h-10 rounded-xl border-2 border-slate-800 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-800 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)]"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Flag className="h-3.5 w-3.5" />
                        Close
                      </span>
                    </button>
                  )}
                </div>
                )}
              </div>
              {roundActionError && (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border-2 border-orange-200 bg-orange-50 px-4 py-3 text-sm font-bold text-orange-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{roundActionError}</span>
                </div>
              )}
              <MatchList
                tournamentId={tournamentId}
                tournamentName={tournament?.name || ''}
                format={tournamentFormat}
                matches={matches}
                players={players}
                isOwner={isOwner}
                canEnterScores={canEnterScores}
                readOnly={readOnly}
                sessions={sessions}
                sessionAbsences={currentSessionAbsences}
              />
            </motion.div>
          )}

          {tab === 'leaderboard' && (
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
              <Leaderboard
                players={players}
                matches={matches}
                format={tournamentFormat}
                pairingMode={tournamentPairingMode}
                canManageTournament={canManageTournament}
                isCreatingPlayoffRound={isCreatingPlayoffRound}
                playoffActionError={playoffActionError}
                onCreatePlayoffRound={createInitialPlayoffRound}
                onCreateNextPlayoffRound={createNextPlayoffRound}
                sessions={sessions}
                currentSession={currentSession}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="px-4 py-3 border-t-2 border-slate-200 bg-white/70 backdrop-blur flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex items-center gap-2 rounded-full border border-lime-300 bg-lime-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-lime-700">
          <span className="h-1.5 w-1.5 rounded-full bg-lime-500 animate-pulse" />
          Live
        </div>
        {canManageTournament && (
          <button
            onClick={() => {
              const spectatorUrl = buildSpectatorUrl(window.location.origin, tournamentId);
              navigator.clipboard.writeText(`Watch our Pickleball tournament live here (No signup required!): ${spectatorUrl}`);
              alert('Spectator link copied!');
            }}
            className="inline-flex items-center gap-2 rounded-xl border-2 border-slate-800 bg-white px-3 py-1.5 text-[10px] font-black uppercase text-slate-700 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] hover:-translate-y-0.5 hover:shadow-[3px_3px_0px_0px_rgba(30,41,59,1)] active:translate-y-0.5 active:shadow-none transition-all duration-150"
          >
            <Copy className="h-3 w-3" />
            Copy Spectator Link
          </button>
        )}
      </footer>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 md:px-7 py-2.5 md:py-4 flex items-center gap-1.5 md:gap-2 text-[10px] md:text-xs font-black transition-all duration-150 border-b-[3px] tracking-widest ${
        active
          ? 'border-lime-400 text-white'
          : 'border-transparent text-slate-500 hover:text-slate-300 hover:border-slate-600'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
