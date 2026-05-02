import React, { useState, useEffect } from 'react';
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
  const isLeague = Boolean(tournament?.leagueMode);
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
      if (isLeague) {
        setSessionManagerMode('new');
        setIsSessionManagerOpen(true);
      } else {
        await generateNextRound();
      }
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
    <div className="min-h-screen bg-lime-50 flex flex-col">
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
      <header className="bg-white border-b-4 border-slate-800 p-4 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-1.5 md:p-2 border-2 border-slate-800 rounded-lg md:rounded-xl hover:bg-lime-100 transition-colors">
              <ChevronLeft className="w-4 h-4 md:w-5 md:h-5" />
            </button>
            <div>
              <h1 className="text-lg md:text-2xl font-black text-lime-900 tracking-tight leading-none uppercase truncate max-w-[150px] md:max-w-none">{tournament?.name}</h1>
              <div className="flex items-center gap-2 mt-1">
                <div className="bg-white border-2 border-lime-400 rounded-lg px-2 py-0.5 flex items-center shadow-[1.5px_1.5px_0px_0px_rgba(163,230,53,1)]">
                   <span className="text-[8px] font-bold text-lime-600 uppercase mr-1">CODE:</span>
                   <span className="text-xs font-mono font-black text-slate-800">{tournament?.code}</span>
                </div>
                <TournamentStatusPill status={tournament?.status} readOnly={readOnly} />
                <span className="inline-flex items-center gap-1 rounded-md border border-orange-300 bg-orange-100 px-2 py-0.5 text-[8px] font-black uppercase text-orange-700">
                  <span>{tournamentFormatTag.label}</span>
                  <span className="text-orange-500">•</span>
                  <span>{tournamentFormatTag.detail}</span>
                </span>
              </div>
            </div>
          </div>
          <button 
            onClick={() => setIsJoinPanelOpen(true)}
            className="p-2 md:p-3 bg-orange-500 text-white rounded-xl md:rounded-2xl border-2 border-slate-800 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] md:shadow-[4px_4px_0px_0px_rgba(30,41,59,1)] hover:translate-y-0.5 transition-all"
            title="Invite Players"
          >
            <Share2 className="w-4 h-4 md:w-5 md:h-5" />
          </button>
        </div>
      </header>

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
            heading={sessionManagerMode === 'adjust' ? 'Who Changed?' : undefined}
            actionLabel={sessionManagerMode === 'adjust' ? 'Save & Rebuild' : 'Start Session'}
            allowBelowMinimum={sessionManagerMode === 'adjust'}
            isCreating={isStartingSession}
            onConfirm={sessionManagerMode === 'adjust' ? adjustCurrentSession : startNewSession}
            onCancel={() => setIsSessionManagerOpen(false)}
          />
        )}
      </AnimatePresence>

      <nav className="bg-white border-b-2 md:border-b-4 border-slate-800 px-2 md:px-4 overflow-x-auto no-scrollbar">
        <div className="max-w-4xl mx-auto flex min-w-max">
          <TabButton active={tab === 'matches'} onClick={() => setTab('matches')} icon={<RotateCcw className="w-3.5 h-3.5 md:w-4 md:h-4" />} label="GAMES" />
          <TabButton active={tab === 'leaderboard'} onClick={() => setTab('leaderboard')} icon={<Trophy className="w-3.5 h-3.5 md:w-4 md:h-4" />} label="RANKINGS" />
          {showSetupTab && (
            <TabButton active={tab === 'setup'} onClick={() => setTab('setup')} icon={<Users className="w-3.5 h-3.5 md:w-4 md:h-4" />} label="PARTICIPANTS" />
          )}
        </div>
      </nav>

      <main className="flex-1 p-3 md:p-8 max-w-4xl mx-auto w-full">
        <AnimatePresence mode="wait">
          {tab === 'setup' && (
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
              <PlayerManager
                tournamentId={tournamentId}
                players={players}
                format={tournamentFormat}
                pairingMode={tournamentPairingMode}
                canAddPlayers={canContributePlayers}
                isOwner={canManageTournament}
                status={tournament?.status || 'setup'}
                isLeague={isLeague}
                onStart={startTournament}
              />
            </motion.div>
          )}

          {tab === 'matches' && (
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
              <div className="flex items-center justify-between mb-6 md:mb-8">
                <h2 className="text-xl md:text-3xl font-black text-slate-800">COURT TRACKER</h2>
                <div className="flex flex-wrap justify-end gap-2">
                  {canCloseTournament && (
                    <button
                      onClick={completeTournament}
                      className="rounded-2xl border-2 border-slate-800 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-800 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)]"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Flag className="h-3.5 w-3.5" />
                        Close Tournament
                      </span>
                    </button>
                  )}
                  {canAdjustCurrentSession && (
                    <button
                      onClick={() => {
                        setSessionManagerMode('adjust');
                        setIsSessionManagerOpen(true);
                      }}
                      disabled={isGeneratingRound || isStartingSession}
                      className="rounded-2xl border-2 border-slate-800 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-800 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)]"
                    >
                      <span className="inline-flex items-center gap-2">
                        <UserMinus className="h-3.5 w-3.5" />
                        Player Left
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
                      className="rounded-2xl border-2 border-slate-800 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-800 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)]"
                    >
                      <span className="inline-flex items-center gap-2">
                        <CalendarDays className="h-3.5 w-3.5" />
                        New Session
                      </span>
                    </button>
                  )}
                  {canGenerateNextRound && (
                    <button
                      onClick={() => generateNextRound()}
                      disabled={isGeneratingRound}
                      className="brutal-button-lime py-2 px-3 md:py-3 md:px-6"
                    >
                      <div className="flex items-center gap-1.5 md:gap-2">
                        {isGeneratingRound ? <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" /> : <Plus className="w-4 h-4 md:w-5 md:h-5" />}
                        <span className="text-xs sm:text-sm">{isGeneratingRound ? 'BUILDING ROUND...' : 'NEXT ROUND'}</span>
                      </div>
                    </button>
                  )}
                </div>
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

      <footer className="p-4 border-t-2 border-lime-200 flex flex-col sm:flex-row items-center justify-between gap-4">
         <div className="bg-orange-50 text-orange-600 px-4 py-1.5 rounded-xl border-2 border-orange-200 font-black text-xs uppercase tracking-tight">
            Live Stream Connected
         </div>

         {canManageTournament && (
           <div className="flex items-center gap-2 bg-white p-2 rounded-xl border-2 border-slate-200 shadow-sm">
             <span className="text-[10px] font-black text-slate-400 uppercase">Spectator URL:</span>
             <code className="text-[10px] font-mono font-bold text-slate-600 bg-slate-50 px-2 py-1 rounded truncate max-w-[150px] md:max-w-xs block">
               {buildSpectatorUrl(window.location.origin, tournamentId)}
             </code>
             <button
               onClick={() => {
                 const spectatorUrl = buildSpectatorUrl(window.location.origin, tournamentId);
                 navigator.clipboard.writeText(`Watch our Pickleball tournament live here (No signup required!): ${spectatorUrl}`);
                 alert('Spectator link copied!');
               }}
               className="bg-lime-400 text-slate-900 px-3 py-1.5 rounded-lg border-2 border-slate-800 text-[10px] font-black uppercase shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] hover:translate-y-0.5 active:translate-y-1 active:shadow-none transition-all"
             >
               Copy
             </button>
           </div>
         )}
      </footer>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`px-4 md:px-8 py-3 md:py-5 flex items-center gap-2 text-[10px] md:text-xs font-black transition-all border-b-2 md:border-b-4 tracking-widest ${
        active ? 'border-orange-500 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
