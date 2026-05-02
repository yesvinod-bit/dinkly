import React, { useEffect, useState } from 'react';
import { 
  doc, 
  collection,
  serverTimestamp, 
  writeBatch,
  Timestamp
} from 'firebase/firestore';
import { db, auth, Player, Match, TournamentFormat, getReadableFirestoreError, handleFirestoreError } from '../lib/firebase';
import { getTournamentFormat } from '../lib/tournamentLogic';
import { CheckCircle2, ChevronRight, User, Swords, Share2, RotateCcw, Clock3, Pencil, PartyPopper, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';

interface Props {
  tournamentId: string;
  tournamentName: string;
  format?: TournamentFormat;
  matches: Match[];
  players: Player[];
  isOwner: boolean;
  canEnterScores?: boolean;
  readOnly?: boolean;
}

interface ScoreCelebration {
  id: number;
  winnerLabel: string;
  scoreLine: string;
  margin: number;
  tone: 'lime' | 'orange';
}

const celebrationCopy = [
  'Score locked. Bragging rights pending.',
  'Result saved. Group chat ammunition loaded.',
  'The scoreboard has spoken, loudly.',
  'That one is officially in the receipts.',
  'Court drama archived successfully.',
  'Winner recorded. Ego management begins now.',
];

const confettiPieces = Array.from({ length: 34 }, (_, index) => ({
  id: index,
  left: `${(index * 29) % 100}%`,
  delay: `${(index % 9) * 0.06}s`,
  duration: `${1.8 + (index % 6) * 0.16}s`,
  drift: `${((index % 7) - 3) * 18}px`,
  rotate: `${(index * 47) % 360}deg`,
}));

function ScoreCelebrationOverlay({ celebration }: { celebration: ScoreCelebration }) {
  const message = celebrationCopy[celebration.id % celebrationCopy.length];

  return (
    <div className="pointer-events-none fixed inset-0 z-[250] overflow-hidden">
      {confettiPieces.map((piece) => (
        <span
          key={`${celebration.id}-${piece.id}`}
          className={`score-confetti score-confetti-${piece.id % 5}`}
          style={{
            left: piece.left,
            animationDelay: piece.delay,
            animationDuration: piece.duration,
            ['--drift' as string]: piece.drift,
            ['--spin' as string]: piece.rotate,
          }}
        />
      ))}
      <div className="absolute inset-x-4 top-[18%] mx-auto max-w-sm">
        <motion.div
          key={celebration.id}
          initial={{ opacity: 0, scale: 0.72, y: 24, rotate: -2 }}
          animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -10 }}
          transition={{ type: 'spring', stiffness: 420, damping: 22 }}
          className={`score-celebration-card ${
            celebration.tone === 'lime' ? 'score-celebration-lime' : 'score-celebration-orange'
          }`}
        >
          <div className="flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-700">
            <PartyPopper className="h-4 w-4" />
            Score Saved
          </div>
          <div className="mt-3 text-center text-2xl font-black uppercase leading-tight text-slate-950">
            {celebration.winnerLabel}
          </div>
          <div className="mt-2 text-center font-mono text-4xl font-black text-slate-950">
            {celebration.scoreLine}
          </div>
          <div className="mt-3 text-center text-xs font-black uppercase tracking-[0.14em] text-slate-700">
            Won by {celebration.margin} {celebration.margin === 1 ? 'point' : 'points'}
          </div>
          <div className="mt-3 rounded-2xl border-2 border-slate-800 bg-white/70 px-3 py-2 text-center text-[11px] font-black uppercase text-slate-800">
            {message}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export default function MatchList({ tournamentId, tournamentName, format, matches, players, isOwner, canEnterScores = false, readOnly = false }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [score1, setScore1] = useState<string>('');
  const [score2, setScore2] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyMatchId, setBusyMatchId] = useState<string | null>(null);
  const [roundTab, setRoundTab] = useState<'active' | 'voided'>('active');
  const [showOlderRounds, setShowOlderRounds] = useState(false);
  const [celebration, setCelebration] = useState<ScoreCelebration | null>(null);
  const tournamentFormat = getTournamentFormat(format);
  const canEditScores = canEnterScores && !readOnly;
  const canManageGameActions = isOwner && !readOnly;
  const playoffStarted = matches.some((match) => match.stage === 'playoff');

  const getPlayerName = (id: string) => players.find(p => p.id === id)?.name || 'Unknown';
  const competitorLabel = tournamentFormat === 'singles' ? 'Player' : 'Team';
  const isFrozenPreliminaryMatch = (match: Match) => playoffStarted && match.stage !== 'playoff';

  useEffect(() => {
    if (!celebration) return;

    const timeoutId = window.setTimeout(() => setCelebration(null), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [celebration]);

  const resetEditor = () => {
    setEditingId(null);
    setScore1('');
    setScore2('');
  };

  const startEditingMatch = (match: Match) => {
    if (isFrozenPreliminaryMatch(match)) {
      setActionError('Preliminary games are frozen after playoffs begin.');
      return;
    }

    setEditingId(match.id);
    setScore1(match.status === 'completed' ? String(match.score1) : '');
    setScore2(match.status === 'completed' ? String(match.score2) : '');
  };

  const getScoreValidationMessage = (s1: number, s2: number) => {
    if (s1 < 0 || s2 < 0) return 'Scores must be zero or higher.';
    if (s1 > 20 || s2 > 20) return 'Scores must stay between 0 and 20.';
    if (s1 === s2) return 'Scores cannot tie.';
    return null;
  };

  const getWinnerTeam = (match: Match): 1 | 2 | null => {
    if (editingId === match.id) {
      const previewScore1 = parseInt(score1);
      const previewScore2 = parseInt(score2);
      if (!Number.isNaN(previewScore1) && !Number.isNaN(previewScore2) && previewScore1 !== previewScore2) {
        return previewScore1 > previewScore2 ? 1 : 2;
      }
    }

    if (match.status === 'completed' && match.score1 !== match.score2) {
      return match.score1 > match.score2 ? 1 : 2;
    }

    return null;
  };

  const shareMatch = (match: Match) => {
    const t1Names = match.team1.map(getPlayerName).join(' & ');
    const t2Names = match.team2.map(getPlayerName).join(' & ');
    const text = `Pickleball Result from ${tournamentName}:\nRound ${match.round}: ${t1Names} (${match.score1}) vs ${t2Names} (${match.score2})`;
    
    if (navigator.share) {
      navigator.share({
        title: 'Match Result',
        text: text,
      });
    } else {
      navigator.clipboard.writeText(text);
      alert('Match details copied to clipboard!');
    }
  };

  const formatMatchTime = (value?: Timestamp | null) => {
    if (!value) return null;

    return value.toDate().toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const repeatMatch = async (match: Match) => {
    if (!canManageGameActions) return;
    setActionError(null);
    setBusyMatchId(match.id);

    try {
      if (playoffStarted) {
        setActionError('Use Rankings to create playoff rounds after playoffs begin.');
        return;
      }
      if (match.status === 'pending') {
        setActionError('Finish or void this game before repeating it.');
        return;
      }

      const nextRound = matches.length > 0 ? Math.max(...matches.map((match) => match.round)) + 1 : 1;
      const batch = writeBatch(db);
      const ref = doc(collection(db, 'tournaments', tournamentId, 'matches'));

      batch.set(ref, {
        round: nextRound,
        team1: match.team1,
        team2: match.team2,
        score1: 0,
        score2: 0,
        status: 'pending',
        updatedAt: serverTimestamp(),
        completedAt: null,
        voidedAt: null,
        statusBeforeVoid: null,
        previousScore1: null,
        previousScore2: null,
        previousCompletedAt: null,
      });

      await batch.commit();
    } catch (e) {
      try {
        handleFirestoreError(e, 'write');
      } catch (firestoreError) {
        setActionError(getReadableFirestoreError(firestoreError, 'Unable to repeat that game right now.'));
      }
    } finally {
      setBusyMatchId(null);
    }
  };

  const voidMatch = async (match: Match) => {
    if (!canManageGameActions) return;
    if (isFrozenPreliminaryMatch(match)) {
      setActionError('Preliminary games are frozen after playoffs begin.');
      return;
    }
    if (!window.confirm(`Void this game in round ${match.round}? Completed scores for this game will be removed from the standings.`)) return;
    setActionError(null);
    setBusyMatchId(match.id);

    try {
      const batch = writeBatch(db);

      const matchRef = doc(db, 'tournaments', tournamentId, 'matches', match.id);
      batch.update(matchRef, {
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

      await batch.commit();
    } catch (e) {
      try {
        handleFirestoreError(e, 'update');
      } catch (firestoreError) {
        setActionError(getReadableFirestoreError(firestoreError, 'Unable to void that game right now.'));
      }
    } finally {
      setBusyMatchId(null);
    }
  };

  const unvoidMatch = async (match: Match) => {
    if (!canManageGameActions) return;
    if (isFrozenPreliminaryMatch(match)) {
      setActionError('Preliminary games are frozen after playoffs begin.');
      return;
    }
    if (!window.confirm(`Restore this game in round ${match.round}? Any completed score for this game will be added back to the standings.`)) return;
    setActionError(null);
    setBusyMatchId(match.id);

    try {
      const batch = writeBatch(db);
      const restoredStatus = match.statusBeforeVoid === 'completed' ? 'completed' : 'pending';
      const restoredScore1 = match.statusBeforeVoid === 'completed' ? (match.previousScore1 ?? 0) : 0;
      const restoredScore2 = match.statusBeforeVoid === 'completed' ? (match.previousScore2 ?? 0) : 0;
      const restoredCompletedAt = match.statusBeforeVoid === 'completed'
        ? (match.previousCompletedAt ?? serverTimestamp())
        : null;

      const matchRef = doc(db, 'tournaments', tournamentId, 'matches', match.id);
      batch.update(matchRef, {
        score1: restoredScore1,
        score2: restoredScore2,
        status: restoredStatus,
        updatedAt: serverTimestamp(),
        completedAt: restoredCompletedAt,
        voidedAt: null,
        statusBeforeVoid: null,
        previousScore1: null,
        previousScore2: null,
        previousCompletedAt: null,
      });

      await batch.commit();
    } catch (e) {
      try {
        handleFirestoreError(e, 'update');
      } catch (firestoreError) {
        setActionError(getReadableFirestoreError(firestoreError, 'Unable to restore that game right now.'));
      }
    } finally {
      setBusyMatchId(null);
    }
  };

  const submitScore = async (match: Match) => {
    if (!canEditScores) return;
    if (isFrozenPreliminaryMatch(match)) {
      setActionError('Preliminary games are frozen after playoffs begin.');
      return;
    }
    const s1 = parseInt(score1, 10);
    const s2 = parseInt(score2, 10);
    setActionError(null);

    if (Number.isNaN(s1) || Number.isNaN(s2)) {
      setActionError('Enter both scores before saving.');
      return;
    }

    const validationMessage = getScoreValidationMessage(s1, s2);
    if (validationMessage) {
      setActionError(validationMessage);
      return;
    }

    if (match.status === 'completed' && !window.confirm(`Overwrite the saved score ${match.score1}-${match.score2} with ${s1}-${s2}? Standings will be recalculated for this game.`)) {
      return;
    }
    
    try {
      const batch = writeBatch(db);
      const matchRef = doc(db, 'tournaments', tournamentId, 'matches', match.id);

      batch.update(matchRef, {
        score1: s1,
        score2: s2,
        status: 'completed',
        updatedAt: serverTimestamp(),
        completedAt: serverTimestamp()
      });

      const claimedRecipientIds = Array.from(new Set(
        players
          .map((player) => player.claimedByUserId)
          .filter((uid): uid is string => Boolean(uid))
      ));

      if (claimedRecipientIds.length > 0) {
        const currentUser = auth.currentUser;
        const notificationRef = doc(collection(db, 'tournaments', tournamentId, 'scoreNotifications'));
        batch.set(notificationRef, {
          matchId: match.id,
          tournamentName,
          round: match.round,
          roundLabel: match.roundLabel || `RD ${match.round}`,
          team1Label: match.team1.map(getPlayerName).join(' & '),
          team2Label: match.team2.map(getPlayerName).join(' & '),
          score1: s1,
          score2: s2,
          previousScore1: match.status === 'completed' ? match.score1 : null,
          previousScore2: match.status === 'completed' ? match.score2 : null,
          action: match.status === 'completed' ? 'modified' : 'entered',
          actorUserId: currentUser?.uid || null,
          actorDisplayName: currentUser?.displayName || currentUser?.email || 'A player',
          recipientUserIds: claimedRecipientIds,
          createdAt: serverTimestamp(),
        });
      }

      await batch.commit();
      const winnerTeam = s1 > s2 ? 1 : 2;
      const winnerIds = winnerTeam === 1 ? match.team1 : match.team2;
      setCelebration({
        id: Date.now(),
        winnerLabel: winnerIds.map(getPlayerName).join(' & '),
        scoreLine: `${s1}-${s2}`,
        margin: Math.abs(s1 - s2),
        tone: winnerTeam === 1 ? 'lime' : 'orange',
      });
      resetEditor();
    } catch (e) {
      try {
        handleFirestoreError(e, 'update');
      } catch (firestoreError) {
        setActionError(getReadableFirestoreError(firestoreError, 'Unable to save that score right now.'));
      }
    }
  };

  const undoScore = async (match: Match) => {
    if (!canManageGameActions) return;
    if (isFrozenPreliminaryMatch(match)) {
      setActionError('Preliminary games are frozen after playoffs begin.');
      return;
    }
    if (!window.confirm('Are you sure you want to undo this score? This will revert player stats.')) return;
    setActionError(null);

    try {
      const batch = writeBatch(db);
      const matchRef = doc(db, 'tournaments', tournamentId, 'matches', match.id);

      batch.update(matchRef, {
        score1: 0,
        score2: 0,
        status: 'pending',
        updatedAt: serverTimestamp(),
        completedAt: null
      });

      await batch.commit();
      resetEditor();
    } catch (e) {
      try {
        handleFirestoreError(e, 'update');
      } catch (firestoreError) {
        setActionError(getReadableFirestoreError(firestoreError, 'Unable to undo that score right now.'));
      }
    }
  };

  const rounds = Array.from(new Set(matches.map(m => m.round))).sort((a, b) => b - a);
  const currentRound = rounds[0] ?? 0;
  const visibleRounds = rounds.filter((round) => {
    const roundMatches = matches.filter((match) => match.round === round);
    const matchesTab = roundTab === 'active'
      ? roundMatches.some((match) => match.status !== 'void')
      : roundMatches.some((match) => match.status === 'void');
    return matchesTab && (showOlderRounds || roundTab === 'voided' || round === currentRound);
  });
  const hiddenOlderRoundCount = rounds.filter((round) =>
    roundTab === 'active' &&
    round !== currentRound &&
    matches.some((match) => match.round === round && match.status !== 'void')
  ).length;

  return (
    <div className="space-y-8 sm:space-y-12">
      {celebration && <ScoreCelebrationOverlay celebration={celebration} />}
      {actionError && (
        <div className="rounded-2xl border-2 border-orange-200 bg-orange-50 px-4 py-3 text-sm font-bold text-orange-700">
          {actionError}
        </div>
      )}
      {matches.some((match) => match.status === 'void') && (
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setRoundTab('active')}
            className={`rounded-2xl border-2 border-slate-800 px-4 py-2 text-xs font-black uppercase shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] ${
              roundTab === 'active' ? 'bg-lime-400 text-slate-900' : 'bg-white text-slate-600'
            }`}
          >
            Games
          </button>
          <button
            onClick={() => setRoundTab('voided')}
            className={`rounded-2xl border-2 border-slate-800 px-4 py-2 text-xs font-black uppercase shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] ${
              roundTab === 'voided' ? 'bg-orange-500 text-white' : 'bg-white text-slate-600'
            }`}
          >
            Voided Games
          </button>
        </div>
      )}
      {roundTab === 'active' && hiddenOlderRoundCount > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowOlderRounds((prev) => !prev)}
            className="rounded-xl border-2 border-slate-800 bg-white px-4 py-2 text-[10px] font-black uppercase text-slate-700 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)]"
          >
            {showOlderRounds ? 'Hide older rounds' : `Show older rounds (${hiddenOlderRoundCount})`}
          </button>
        </div>
      )}
      {visibleRounds.map(round => (
        <div key={round}>
          {(() => {
            const roundMatches = matches
              .filter((match) => (
                match.round === round && (roundTab === 'active' ? match.status !== 'void' : match.status === 'void')
              ))
              .sort((a, b) => {
                if (a.status === b.status) return a.id.localeCompare(b.id);
                if (a.status === 'pending') return -1;
                if (b.status === 'pending') return 1;
                return a.status.localeCompare(b.status);
              });
            const activePlayerIds = new Set(roundMatches.flatMap((match) => [...match.team1, ...match.team2]));
            const benchedPlayers = roundTab === 'active'
              ? players.filter((player) => !activePlayerIds.has(player.id))
              : [];
            const roundLabel = roundMatches.find((match) => match.roundLabel)?.roundLabel || `RD ${round}`;
            const isPlayoffRound = roundMatches.some((match) => match.stage === 'playoff');

            return (
              <>
          <div className="mb-4 flex items-center gap-4 sm:mb-6">
            <span className="bg-zinc-900 text-white px-3 py-1 rounded-full text-xs font-bold font-mono uppercase">{roundLabel}</span>
            {roundLabel !== `RD ${round}` && (
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                RD {round}
              </span>
            )}
            {isPlayoffRound && (
              <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-orange-700">
                Playoff
              </span>
            )}
            <div className="h-px bg-zinc-100 flex-1" />
            {roundTab === 'voided' && (
              <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-orange-700">
                VOIDED
              </span>
            )}
          </div>
          {roundTab === 'active' && benchedPlayers.length > 0 && (
            <div className="mb-5 rounded-3xl border-2 border-slate-800 bg-gradient-to-r from-orange-100 via-amber-50 to-lime-100 p-4 shadow-[3px_3px_0px_0px_rgba(30,41,59,1)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-800 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white">
                  Bench
                </span>
                <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-600">
                  Sitting out this round
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {benchedPlayers.map((player) => (
                  <span
                    key={player.id}
                    className="rounded-full border-2 border-slate-800 bg-white px-3 py-2 text-sm font-black text-slate-800 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)]"
                  >
                    {player.name}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            {roundMatches.map((match) => (
              (() => {
                const winnerTeam = getWinnerTeam(match);
                const isEditingThisMatch = editingId === match.id;
                const canEditThisMatch = canEditScores && !isFrozenPreliminaryMatch(match);
                const canManageThisMatch = canManageGameActions && !isFrozenPreliminaryMatch(match);
                const inlineValidation = isEditingThisMatch && score1 !== '' && score2 !== ''
                  ? getScoreValidationMessage(parseInt(score1, 10), parseInt(score2, 10))
                  : null;

                return (
              <motion.div 
                key={match.id}
                layout
                className={`brutal-card relative overflow-hidden p-3 sm:p-6 transition-all ${
                  match.status === 'completed' ? 'match-card-completed' : ''
                }`}
              >
                {match.status === 'completed' && (
                  <>
                    <div className="score-win-glow" />
                    <div className="pointer-events-none absolute right-3 top-12 z-0 hidden flex-col gap-2 sm:flex">
                      <span className="score-flight-chip score-flight-chip-lime">Winner</span>
                      <span className="score-flight-chip score-flight-chip-orange">+{Math.abs(match.score1 - match.score2)}</span>
                    </div>
                  </>
                )}
                <div className="flex items-center justify-between mb-3 sm:mb-6">
                   <div className="flex flex-wrap items-center gap-1.5 text-slate-400 font-mono text-[9px] sm:text-xs uppercase font-black">
                     <span className="inline-flex items-center gap-1.5">
                       <Swords className="w-2.5 h-2.5" /> GAME {match.id.slice(-4).toUpperCase()}
                     </span>
                     {match.stage === 'playoff' && match.seed1 && match.seed2 && (
                       <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 font-sans text-[8px] font-black tracking-[0.14em] text-orange-700">
                         Seed {match.seed1} vs {match.seed2}
                       </span>
                     )}
                   </div>
                   {match.status === 'void' && (
                     <div className="flex items-center gap-2 sm:gap-3">
                       <span className="flex items-center gap-1 text-orange-700 text-[9px] sm:text-xs font-black uppercase tracking-wider bg-orange-50 px-1.5 py-0.5 rounded border border-orange-200">
                         <span className="hidden xs:inline">Voided</span>
                         <span className="xs:hidden">Void</span>
                       </span>
                     </div>
                   )}
                   {match.status === 'completed' && (
                     <div className="flex items-center gap-2 sm:gap-3">
                       <span className="score-pulse-pill flex items-center gap-1 text-lime-600 text-[9px] sm:text-xs font-black uppercase tracking-wider bg-lime-50 px-1.5 py-0.5 rounded border border-lime-200">
                         <CheckCircle2 className="w-3 h-3" /> <span className="hidden xs:inline">Completed</span>
                       </span>
                       <button 
                          onClick={() => shareMatch(match)}
                          className="p-1 sm:p-1.5 bg-white border border-slate-800 rounded-lg text-slate-800 hover:bg-orange-50 transition-colors shadow-[1.5px_1.5px_0px_0px_rgba(30,41,59,1)]"
                          title="Share Match Result"
                        >
                          <Share2 className="w-2.5 sm:w-3.5 h-2.5 sm:h-3.5" />
                        </button>
                       {canEditThisMatch && (
                         <button 
                           onClick={() => startEditingMatch(match)}
                           className="p-1 sm:p-1.5 bg-white border border-slate-800 rounded-lg text-slate-800 hover:bg-sky-50 transition-colors shadow-[1.5px_1.5px_0px_0px_rgba(30,41,59,1)]"
                           title="Edit Score"
                         >
                           <Pencil className="w-2.5 sm:w-3.5 h-2.5 sm:h-3.5" />
                         </button>
                       )}
                       {canManageThisMatch && (
                         <button 
                           onClick={() => undoScore(match)}
                           className="p-1 sm:p-1.5 bg-white border border-slate-800 rounded-lg text-orange-500 hover:bg-orange-50 transition-colors shadow-[1.5px_1.5px_0px_0px_rgba(30,41,59,1)]"
                           title="Undo Score"
                         >
                           <RotateCcw className="w-2.5 sm:w-3.5 h-2.5 sm:h-3.5" />
                         </button>
                       )}
                     </div>
                   )}
                </div>

                <div className="grid grid-cols-5 items-center gap-1 sm:gap-4">
                  <div className="col-span-2 space-y-1 sm:space-y-2">
                    {match.team1.map(pid => (
                      <div key={pid} className={`flex items-center gap-1.5 rounded-xl px-1.5 py-1 text-[11px] sm:text-lg font-black truncate transition-colors ${
                        winnerTeam === 1 ? 'winner-name-pop bg-lime-100 text-lime-900 ring-2 ring-lime-300' : 'text-slate-800'
                      }`}>
                        <div className={`w-4 h-4 sm:w-8 sm:h-8 rounded-md sm:rounded-lg border border-slate-800 flex items-center justify-center text-slate-800 shrink-0 ${
                          winnerTeam === 1 ? 'bg-lime-300' : 'bg-lime-100'
                        }`}>
                          <User className="w-2.5 h-2.5 sm:w-4 sm:h-4" />
                        </div>
                        {winnerTeam === 1 && <Sparkles className="h-3 w-3 shrink-0 text-lime-600" />}
                        <span className="truncate">{getPlayerName(pid)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="col-span-1 flex flex-col items-center justify-center">
                    <div className="bg-lime-400 w-6 h-6 sm:w-12 sm:h-12 rounded-full border-2 border-slate-800 flex items-center justify-center font-black text-[10px] sm:text-lg italic shadow-[1.5px_1.5px_0px_0px_rgba(30,41,59,1)]">
                      VS
                    </div>
                  </div>

                  <div className="col-span-2 space-y-1 sm:space-y-2 text-right">
                    {match.team2.map(pid => (
                      <div key={pid} className={`flex items-center justify-end gap-1.5 rounded-xl px-1.5 py-1 text-[11px] sm:text-lg font-black truncate transition-colors ${
                        winnerTeam === 2 ? 'winner-name-pop bg-orange-100 text-orange-900 ring-2 ring-orange-300' : 'text-slate-800'
                      }`}>
                        <span className="truncate">{getPlayerName(pid)}</span>
                        {winnerTeam === 2 && <Sparkles className="h-3 w-3 shrink-0 text-orange-600" />}
                        <div className={`w-4 h-4 sm:w-8 sm:h-8 rounded-md sm:rounded-lg border border-slate-800 flex items-center justify-center text-slate-800 shrink-0 ${
                          winnerTeam === 2 ? 'bg-orange-300' : 'bg-orange-100'
                        }`}>
                          <User className="w-2.5 h-2.5 sm:w-4 sm:h-4" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 flex justify-center">
                   <div className={`bg-slate-800 rounded-xl px-4 py-1.5 border-2 border-white shadow-[3px_3px_0px_0px_rgba(163,230,53,1)] ${
                     match.status === 'completed' ? 'score-result-bounce' : ''
                   }`}>
                      <div className="font-mono text-xl sm:text-2xl font-black tracking-tighter flex items-center text-white">
                        <span className={match.score1 > match.score2 ? 'text-lime-400' : 'text-white'}>
                          {match.score1}
                        </span>
                        <span className="text-slate-500 mx-2">-</span>
                        <span className={match.score2 > match.score1 ? 'text-lime-400' : 'text-white'}>
                          {match.score2}
                        </span>
                      </div>
                   </div>
                </div>

                {match.status === 'completed' && formatMatchTime(match.completedAt) && (
                  <div className="mt-3 flex justify-center">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-orange-700">
                      <Clock3 className="w-3 h-3" />
                      Scored {formatMatchTime(match.completedAt)}
                    </div>
                  </div>
                )}

                {match.status === 'void' && (
                  <div className="mt-3 flex justify-center">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-orange-700">
                      Voided {match.voidedAt ? formatMatchTime(match.voidedAt) : ''}
                    </div>
                  </div>
                )}

                {canManageThisMatch && (
                  <div className="mt-4 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:justify-center">
                    {match.status !== 'pending' && !playoffStarted && (
                      <button
                        onClick={() => repeatMatch(match)}
                        disabled={busyMatchId === match.id}
                        className="min-h-11 rounded-xl border-2 border-slate-800 bg-white px-3 py-3 text-[10px] font-black uppercase shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyMatchId === match.id ? 'Working...' : 'Repeat Game'}
                      </button>
                    )}
                    {match.status === 'void' ? (
                      <button
                        onClick={() => unvoidMatch(match)}
                        disabled={busyMatchId === match.id}
                        className="min-h-11 rounded-xl border-2 border-slate-800 bg-lime-400 px-3 py-3 text-[10px] font-black uppercase text-slate-900 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyMatchId === match.id ? 'Working...' : 'Unvoid Game'}
                      </button>
                    ) : (
                      <button
                        onClick={() => voidMatch(match)}
                        disabled={busyMatchId === match.id}
                        className="min-h-11 rounded-xl border-2 border-slate-800 bg-orange-500 px-3 py-3 text-[10px] font-black uppercase text-white shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyMatchId === match.id ? 'Working...' : 'Void Game'}
                      </button>
                    )}
                  </div>
                )}

                {canEditThisMatch && match.status !== 'void' && (
                  <div className="mt-6 pt-4 border-t-2 border-dashed border-slate-200">
                    {isEditingThisMatch ? (
                      <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-center gap-2 w-full">
                          <div className="flex flex-col items-center gap-1 flex-1">
                            <span className={`text-[10px] font-bold uppercase tracking-[0.16em] ${winnerTeam === 1 ? 'text-lime-600' : 'text-slate-400'}`}>{competitorLabel} 1</span>
                            <input 
                              type="number"
                              min="0"
                              max="20"
                              value={score1}
                              onChange={e => {
                                const val = e.target.value;
                                if (val === '' || (parseInt(val) >= 0 && parseInt(val) <= 20)) {
                                  setScore1(val);
                                }
                              }}
                              className="h-14 w-full rounded-2xl border-2 border-slate-800 bg-white text-center text-2xl font-black text-slate-900 shadow-[3px_3px_0px_0px_rgba(30,41,59,1)] focus:outline-none focus:ring-4 focus:ring-lime-200 p-0"
                            />
                          </div>
                          <span className="mt-3 text-slate-800 font-black text-xl">:</span>
                          <div className="flex flex-col items-center gap-1 flex-1">
                            <span className={`text-[10px] font-bold uppercase tracking-[0.16em] ${winnerTeam === 2 ? 'text-orange-600' : 'text-slate-400'}`}>{competitorLabel} 2</span>
                            <input 
                              type="number"
                              min="0"
                              max="20"
                              value={score2}
                              onChange={e => {
                                const val = e.target.value;
                                if (val === '' || (parseInt(val) >= 0 && parseInt(val) <= 20)) {
                                  setScore2(val);
                                }
                              }}
                              className="h-14 w-full rounded-2xl border-2 border-slate-800 bg-white text-center text-2xl font-black text-slate-900 shadow-[3px_3px_0px_0px_rgba(30,41,59,1)] focus:outline-none focus:ring-4 focus:ring-orange-200 p-0"
                            />
                          </div>
                        </div>
                        <div className={`rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] ${
                          inlineValidation
                            ? 'border-orange-200 bg-orange-50 text-orange-700'
                            : 'border-sky-200 bg-sky-50 text-sky-700'
                        }`}>
                          {inlineValidation || 'Scores cannot tie, stay between 0 and 20, and the winning side is highlighted live.'}
                        </div>
                        <div className="sticky bottom-3 z-10 -mx-1 rounded-3xl border-2 border-slate-800 bg-white/95 p-2 shadow-[4px_4px_0px_0px_rgba(30,41,59,1)] backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
                          <div className="flex gap-2 w-full">
                          <button 
                            onClick={resetEditor}
                            className="min-h-12 flex-1 bg-zinc-100 border-2 border-slate-800 rounded-xl font-bold text-[11px] uppercase"
                          >
                            CANCEL
                          </button>
                          <button 
                            onClick={() => submitScore(match)}
                            className="min-h-12 flex-[2] brutal-button-orange py-3 px-6 whitespace-nowrap text-[11px] mb-0"
                          >
                            SAVE
                          </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <button 
                        onClick={() => startEditingMatch(match)}
                        className="w-full min-h-12 py-3 bg-lime-400 border-2 border-slate-800 rounded-xl shadow-[3px_3px_0px_0px_rgba(30,41,59,1)] font-black text-sm flex items-center justify-center gap-2 group hover:translate-y-0.5 active:translate-y-1 active:shadow-none transition-all uppercase"
                      >
                        {match.status === 'completed' ? 'EDIT SCORE' : 'ENTER SCORE'}
                        <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </button>
                    )}
                  </div>
                )}
              </motion.div>
                );
              })()
            ))}
          </div>
              </>
            );
          })()}
        </div>
      ))}
      {matches.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-10 text-center">
          <div className="w-16 h-16 bg-lime-50 rounded-2xl flex items-center justify-center mx-auto mb-6 border-2 border-lime-100">
            <Swords className="w-8 h-8 text-lime-400" />
          </div>
          <p className="font-black uppercase text-slate-800">No games scheduled yet</p>
          <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
            Add players in Participants, then kick off the tournament.
          </p>
        </div>
      )}
      {matches.length > 0 && visibleRounds.length === 0 && (
        <div className="p-12 text-center">
          <div className="w-16 h-16 bg-zinc-100 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <Swords className="w-8 h-8 text-zinc-300" />
          </div>
          <p className="text-zinc-400 font-medium">
            {roundTab === 'voided' ? 'No voided rounds yet' : 'No active rounds to show'}
          </p>
        </div>
      )}
    </div>
  );
}
