import React, { useState } from 'react';
import { 
  doc, 
  collection,
  updateDoc, 
  serverTimestamp, 
  writeBatch,
  increment,
  Timestamp
} from 'firebase/firestore';
import { db, Player, Match, TournamentFormat, getReadableFirestoreError, handleFirestoreError } from '../lib/firebase';
import { getTournamentFormat } from '../lib/tournamentLogic';
import { CheckCircle2, ChevronRight, User, Swords, Share2, RotateCcw, Clock3, Pencil } from 'lucide-react';
import { motion } from 'motion/react';

interface Props {
  tournamentId: string;
  tournamentName: string;
  format?: TournamentFormat;
  matches: Match[];
  players: Player[];
  isOwner: boolean;
  readOnly?: boolean;
}

export default function MatchList({ tournamentId, tournamentName, format, matches, players, isOwner, readOnly = false }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [score1, setScore1] = useState<string>('');
  const [score2, setScore2] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyMatchId, setBusyMatchId] = useState<string | null>(null);
  const [roundTab, setRoundTab] = useState<'active' | 'voided'>('active');
  const tournamentFormat = getTournamentFormat(format);
  const canEditScores = isOwner && !readOnly;

  const getPlayerName = (id: string) => players.find(p => p.id === id)?.name || 'Unknown';
  const competitorLabel = tournamentFormat === 'singles' ? 'Player' : 'Team';

  const resetEditor = () => {
    setEditingId(null);
    setScore1('');
    setScore2('');
  };

  const startEditingMatch = (match: Match) => {
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

  const applyCompletedMatchDelta = (
    batch: ReturnType<typeof writeBatch>,
    match: Match,
    direction: 1 | -1
  ) => {
    const diff = Math.abs(match.score1 - match.score2);
    if (diff === 0) return;

    const winTeam = match.score1 > match.score2 ? 1 : 2;
    const winPlayers = winTeam === 1 ? match.team1 : match.team2;
    const losePlayers = winTeam === 1 ? match.team2 : match.team1;

    winPlayers.forEach((pid) => {
      const pRef = doc(db, 'tournaments', tournamentId, 'players', pid);
      batch.update(pRef, {
        points: increment(diff * direction),
        gamesPlayed: increment(direction),
        wins: increment(direction),
      });
    });

    losePlayers.forEach((pid) => {
      const pRef = doc(db, 'tournaments', tournamentId, 'players', pid);
      batch.update(pRef, {
        points: increment(-diff * direction),
        gamesPlayed: increment(direction),
      });
    });
  };

  const repeatMatch = async (match: Match) => {
    if (!canEditScores) return;
    setActionError(null);
    setBusyMatchId(match.id);

    try {
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
    if (!canEditScores) return;
    if (!window.confirm(`Void this game in round ${match.round}? Completed scores for this game will be removed from the standings.`)) return;
    setActionError(null);
    setBusyMatchId(match.id);

    try {
      const batch = writeBatch(db);

      if (match.status === 'completed') {
        applyCompletedMatchDelta(batch, match, -1);
      }

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
    if (!canEditScores) return;
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

      if (match.statusBeforeVoid === 'completed') {
        applyCompletedMatchDelta(batch, {
          ...match,
          status: 'completed',
          score1: restoredScore1,
          score2: restoredScore2,
        }, 1);
      }

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

      if (match.status === 'completed') {
        applyCompletedMatchDelta(batch, match, -1);
      }

      batch.update(matchRef, {
        score1: s1,
        score2: s2,
        status: 'completed',
        updatedAt: serverTimestamp(),
        completedAt: serverTimestamp()
      });

      applyCompletedMatchDelta(batch, {
        ...match,
        score1: s1,
        score2: s2,
        status: 'completed',
      }, 1);

      await batch.commit();
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
    if (!canEditScores) return;
    if (!window.confirm('Are you sure you want to undo this score? This will revert player stats.')) return;
    setActionError(null);

    try {
      const batch = writeBatch(db);
      const matchRef = doc(db, 'tournaments', tournamentId, 'matches', match.id);

      const s1 = match.score1;
      const s2 = match.score2;
      const diff = Math.abs(s1 - s2);
      const winTeam = s1 > s2 ? 1 : 2;
      const winPlayers = winTeam === 1 ? match.team1 : match.team2;
      const losePlayers = winTeam === 1 ? match.team2 : match.team1;

      // Revert player stats
      winPlayers.forEach(pid => {
        const pRef = doc(db, 'tournaments', tournamentId, 'players', pid);
        batch.update(pRef, {
          points: increment(-diff),
          gamesPlayed: increment(-1),
          wins: increment(-1)
        });
      });

      losePlayers.forEach(pid => {
        const pRef = doc(db, 'tournaments', tournamentId, 'players', pid);
        batch.update(pRef, {
          points: increment(diff),
          gamesPlayed: increment(-1)
        });
      });

      // Reset match
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
  const visibleRounds = rounds.filter((round) => {
    const roundMatches = matches.filter((match) => match.round === round);
    return roundTab === 'active'
      ? roundMatches.some((match) => match.status !== 'void')
      : roundMatches.some((match) => match.status === 'void');
  });

  return (
    <div className="space-y-8 sm:space-y-12">
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
      {visibleRounds.map(round => (
        <div key={round}>
          {(() => {
            const roundMatches = matches.filter((match) => (
              match.round === round && (roundTab === 'active' ? match.status !== 'void' : match.status === 'void')
            ));
            const activePlayerIds = new Set(roundMatches.flatMap((match) => [...match.team1, ...match.team2]));
            const benchedPlayers = roundTab === 'active'
              ? players.filter((player) => !activePlayerIds.has(player.id))
              : [];

            return (
              <>
          <div className="mb-4 flex items-center gap-4 sm:mb-6">
            <span className="bg-zinc-900 text-white px-3 py-1 rounded-full text-xs font-bold font-mono">RD {round}</span>
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
                const inlineValidation = isEditingThisMatch && score1 !== '' && score2 !== ''
                  ? getScoreValidationMessage(parseInt(score1, 10), parseInt(score2, 10))
                  : null;

                return (
              <motion.div 
                key={match.id}
                layout
                className={`brutal-card p-3 sm:p-6 transition-all ${
                  match.status === 'completed' ? 'opacity-80' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-3 sm:mb-6">
                   <div className="flex items-center gap-1.5 text-slate-400 font-mono text-[9px] sm:text-xs uppercase font-black">
                     <Swords className="w-2.5 h-2.5" /> GAME {match.id.slice(-4).toUpperCase()}
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
                       <span className="flex items-center gap-1 text-lime-600 text-[9px] sm:text-xs font-black uppercase tracking-wider bg-lime-50 px-1.5 py-0.5 rounded border border-lime-200">
                         <CheckCircle2 className="w-3 h-3" /> <span className="hidden xs:inline">Completed</span>
                       </span>
                       <button 
                          onClick={() => shareMatch(match)}
                          className="p-1 sm:p-1.5 bg-white border border-slate-800 rounded-lg text-slate-800 hover:bg-orange-50 transition-colors shadow-[1.5px_1.5px_0px_0px_rgba(30,41,59,1)]"
                          title="Share Match Result"
                        >
                          <Share2 className="w-2.5 sm:w-3.5 h-2.5 sm:h-3.5" />
                        </button>
                       {canEditScores && (
                         <button 
                           onClick={() => startEditingMatch(match)}
                           className="p-1 sm:p-1.5 bg-white border border-slate-800 rounded-lg text-slate-800 hover:bg-sky-50 transition-colors shadow-[1.5px_1.5px_0px_0px_rgba(30,41,59,1)]"
                           title="Edit Score"
                         >
                           <Pencil className="w-2.5 sm:w-3.5 h-2.5 sm:h-3.5" />
                         </button>
                       )}
                       {canEditScores && (
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
                        winnerTeam === 1 ? 'bg-lime-100 text-lime-900 ring-2 ring-lime-300' : 'text-slate-800'
                      }`}>
                        <div className={`w-4 h-4 sm:w-8 sm:h-8 rounded-md sm:rounded-lg border border-slate-800 flex items-center justify-center text-slate-800 shrink-0 ${
                          winnerTeam === 1 ? 'bg-lime-300' : 'bg-lime-100'
                        }`}>
                          <User className="w-2.5 h-2.5 sm:w-4 sm:h-4" />
                        </div>
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
                        winnerTeam === 2 ? 'bg-orange-100 text-orange-900 ring-2 ring-orange-300' : 'text-slate-800'
                      }`}>
                        <span className="truncate">{getPlayerName(pid)}</span>
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
                   <div className="bg-slate-800 rounded-xl px-4 py-1.5 border-2 border-white shadow-[3px_3px_0px_0px_rgba(163,230,53,1)]">
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

                {canEditScores && (
                  <div className="mt-4 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:justify-center">
                    {match.status !== 'pending' && (
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

                {canEditScores && match.status !== 'void' && (
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
        <div className="p-24 text-center">
          <div className="w-16 h-16 bg-zinc-100 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <Swords className="w-8 h-8 text-zinc-300" />
          </div>
          <p className="text-zinc-400 font-medium">No matches scheduled yet</p>
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
