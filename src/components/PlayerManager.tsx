import React, { useState } from 'react';
import { 
  collection, 
  addDoc, 
  deleteField,
  deleteDoc, 
  doc, 
  updateDoc,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { auth, db, Player, TournamentFormat, TournamentPairingMode, getReadableFirestoreError } from '../lib/firebase';
import { getFixedPairingStatus, getMinimumPlayers, getTournamentFormat, getTournamentPairingMode } from '../lib/tournamentLogic';
import { BadgeCheck, Link2, Shuffle, Unlink2, UserMinus, UserPlus, PlayCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  tournamentId: string;
  players: Player[];
  format?: TournamentFormat;
  pairingMode?: TournamentPairingMode;
  canAddPlayers: boolean;
  isOwner: boolean;
  status: string;
  onStart: () => void;
}

export default function PlayerManager({ tournamentId, players, format, pairingMode, canAddPlayers, isOwner, status, onStart }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyPlayerId, setBusyPlayerId] = useState<string | null>(null);
  const [pairPlayerAId, setPairPlayerAId] = useState('');
  const [pairPlayerBId, setPairPlayerBId] = useState('');
  const tournamentFormat = getTournamentFormat(format);
  const tournamentPairingMode = getTournamentPairingMode(pairingMode, tournamentFormat);
  const minimumPlayers = getMinimumPlayers(tournamentFormat);
  const fixedPairingStatus = getFixedPairingStatus(players);
  const isFixedPairMode = tournamentFormat === 'doubles' && tournamentPairingMode === 'fixed';
  const canStartTournament = players.length >= minimumPlayers && (!isFixedPairMode || fixedPairingStatus.isReady);
  const currentUser = auth.currentUser;
  const currentUserEmail = currentUser?.email || '';
  const currentUserName = currentUser?.displayName?.trim() || currentUserEmail.split('@')[0] || 'Player';
  const claimedPlayer = currentUser
    ? players.find((player) => player.claimedByUserId === currentUser.uid)
    : undefined;

  const normalizePlayerName = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  const suggestedClaimPlayer = currentUser
    ? players.find((player) => (
        !player.claimedByUserId &&
        normalizePlayerName(player.name) === normalizePlayerName(currentUserName)
      ))
    : undefined;

  const addPlayer = async () => {
    if (!name.trim()) return;
    setError(null);
    try {
      await addDoc(collection(db, 'tournaments', tournamentId, 'players'), {
        name: name.trim(),
        points: 0,
        gamesPlayed: 0,
        wins: 0,
        addedAt: serverTimestamp()
      });
      setName('');
    } catch (e) {
      console.error(e);
      setError(getReadableFirestoreError(e, 'Unable to add player right now.'));
    }
  };

  const removePlayer = async (id: string) => {
    if (!confirm('Remove player?')) return;
    setError(null);
    try {
      const player = players.find((candidate) => candidate.id === id);
      const playerRef = doc(db, 'tournaments', tournamentId, 'players', id);

      if (player?.fixedPairId) {
        const batch = writeBatch(db);
        players
          .filter((candidate) => candidate.id !== id && candidate.fixedPairId === player.fixedPairId)
          .forEach((candidate) => {
            batch.update(doc(db, 'tournaments', tournamentId, 'players', candidate.id), {
              fixedPairId: deleteField(),
            });
          });
        batch.delete(playerRef);
        await batch.commit();
        return;
      }

      await deleteDoc(playerRef);
    } catch (e) {
      console.error(e);
      setError(getReadableFirestoreError(e, 'Unable to remove player. Make sure the tournament is still in setup mode.'));
    }
  };

  const addSelf = async () => {
    if (!currentUser) return;
    setError(null);
    setBusyPlayerId('self');
    try {
      await addDoc(collection(db, 'tournaments', tournamentId, 'players'), {
        name: currentUserName,
        points: 0,
        gamesPlayed: 0,
        wins: 0,
        addedAt: serverTimestamp(),
        claimedByUserId: currentUser.uid,
        claimedByEmail: currentUserEmail,
        claimedAt: serverTimestamp()
      });
    } catch (e) {
      console.error(e);
      setError(getReadableFirestoreError(e, 'Unable to add you to this tournament right now.'));
    } finally {
      setBusyPlayerId(null);
    }
  };

  const changePairingMode = async (mode: TournamentPairingMode) => {
    if (!isOwner || status !== 'setup' || tournamentFormat !== 'doubles') return;
    setError(null);
    setBusyPlayerId(`pairing-${mode}`);
    try {
      await updateDoc(doc(db, 'tournaments', tournamentId), {
        pairingMode: mode,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error(e);
      setError(getReadableFirestoreError(e, 'Unable to update pairing mode right now.'));
    } finally {
      setBusyPlayerId(null);
    }
  };

  const createFixedPair = async () => {
    if (!pairPlayerAId || !pairPlayerBId || pairPlayerAId === pairPlayerBId) return;
    setError(null);
    setBusyPlayerId('pair-create');
    try {
      const pairId = `fixed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const batch = writeBatch(db);
      [pairPlayerAId, pairPlayerBId].forEach((playerId) => {
        batch.update(doc(db, 'tournaments', tournamentId, 'players', playerId), {
          fixedPairId: pairId,
        });
      });
      await batch.commit();
      setPairPlayerAId('');
      setPairPlayerBId('');
    } catch (e) {
      console.error(e);
      setError(getReadableFirestoreError(e, 'Unable to save that fixed pair right now.'));
    } finally {
      setBusyPlayerId(null);
    }
  };

  const clearFixedPair = async (pairId: string) => {
    if (!isOwner || status !== 'setup') return;
    setError(null);
    setBusyPlayerId(`pair-${pairId}`);
    try {
      const batch = writeBatch(db);
      players
        .filter((player) => player.fixedPairId === pairId)
        .forEach((player) => {
          batch.update(doc(db, 'tournaments', tournamentId, 'players', player.id), {
            fixedPairId: deleteField(),
          });
        });
      await batch.commit();
    } catch (e) {
      console.error(e);
      setError(getReadableFirestoreError(e, 'Unable to clear that fixed pair right now.'));
    } finally {
      setBusyPlayerId(null);
    }
  };

  const claimPlayer = async (player: Player) => {
    if (!currentUser) return;
    if (!confirm(`Claim ${player.name} as your player profile for this tournament?`)) return;
    setError(null);
    setBusyPlayerId(player.id);
    try {
      await updateDoc(doc(db, 'tournaments', tournamentId, 'players', player.id), {
        claimedByUserId: currentUser.uid,
        claimedByEmail: currentUserEmail,
        claimedAt: serverTimestamp()
      });
    } catch (e) {
      console.error(e);
      setError(getReadableFirestoreError(e, 'Unable to claim that player right now.'));
    } finally {
      setBusyPlayerId(null);
    }
  };

  const getPlayerName = (playerId: string) => players.find((player) => player.id === playerId)?.name || 'Unknown';
  const unpairedPlayers = fixedPairingStatus.unpairedPlayers;
  const allFixedPairs = [...fixedPairingStatus.pairs, ...fixedPairingStatus.invalidPairs];

  return (
    <div className="space-y-8">
      <div className="brutal-card p-6 sm:p-8">
        <h2 className="text-2xl font-black mb-2 text-slate-800 uppercase italic">RECRUIT PLAYERS</h2>
        <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest mb-6">
          Setup Phase: Add at least {minimumPlayers} participants for {tournamentFormat}
        </p>
        
        {status === 'setup' && (
          <div className="mb-4 rounded-2xl border-2 border-lime-200 bg-lime-50 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-lime-800">
            {canAddPlayers
              ? 'Anyone who joined this tournament can add names before kickoff.'
              : 'Roster editing is only available to joined tournament players.'}
          </div>
        )}

        {status === 'setup' && isOwner && tournamentFormat === 'doubles' && (
          <div className="mb-4 rounded-2xl border-2 border-slate-800 bg-white px-4 py-4 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Pairing Mode</p>
                <p className="mt-1 text-sm font-black uppercase text-slate-800">
                  {tournamentPairingMode === 'fixed' ? 'Fixed pairs' : 'Random partners'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:w-auto">
                <button
                  type="button"
                  onClick={() => changePairingMode('random')}
                  disabled={busyPlayerId === 'pairing-random'}
                  className={`rounded-xl border-2 border-slate-800 px-3 py-2 text-[10px] font-black uppercase shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] transition-all disabled:opacity-50 ${
                    tournamentPairingMode === 'random' ? 'bg-lime-400 text-slate-900' : 'bg-white text-slate-700'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Shuffle className="h-3.5 w-3.5" />
                    Random Pair
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => changePairingMode('fixed')}
                  disabled={busyPlayerId === 'pairing-fixed'}
                  className={`rounded-xl border-2 border-slate-800 px-3 py-2 text-[10px] font-black uppercase shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] transition-all disabled:opacity-50 ${
                    tournamentPairingMode === 'fixed' ? 'bg-orange-500 text-white' : 'bg-white text-slate-700'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5" />
                    Fixed Pair
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {isFixedPairMode && (
          <div className="mb-6 rounded-2xl border-2 border-orange-200 bg-orange-50 px-4 py-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-700">Fixed Teams</p>
                <p className="mt-1 text-sm font-bold text-orange-800">
                  {fixedPairingStatus.issue || `${fixedPairingStatus.pairs.length} fixed pairs ready.`}
                </p>
              </div>
              <span className={`inline-flex w-fit rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${
                fixedPairingStatus.isReady
                  ? 'border-lime-300 bg-lime-100 text-lime-800'
                  : 'border-orange-300 bg-white text-orange-700'
              }`}>
                {fixedPairingStatus.isReady ? 'Ready' : 'Needs Pairing'}
              </span>
            </div>

            {status === 'setup' && isOwner && (
              <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <select
                  value={pairPlayerAId}
                  onChange={(event) => {
                    setPairPlayerAId(event.target.value);
                    if (event.target.value === pairPlayerBId) setPairPlayerBId('');
                  }}
                  className="brutal-input min-w-0 text-sm"
                >
                  <option value="">Player 1</option>
                  {unpairedPlayers.map((player) => (
                    <option key={player.id} value={player.id}>{player.name}</option>
                  ))}
                </select>
                <select
                  value={pairPlayerBId}
                  onChange={(event) => {
                    setPairPlayerBId(event.target.value);
                    if (event.target.value === pairPlayerAId) setPairPlayerAId('');
                  }}
                  className="brutal-input min-w-0 text-sm"
                >
                  <option value="">Player 2</option>
                  {unpairedPlayers
                    .filter((player) => player.id !== pairPlayerAId)
                    .map((player) => (
                      <option key={player.id} value={player.id}>{player.name}</option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={createFixedPair}
                  disabled={!pairPlayerAId || !pairPlayerBId || busyPlayerId === 'pair-create'}
                  className="rounded-xl border-2 border-slate-800 bg-lime-400 px-4 py-3 text-[10px] font-black uppercase text-slate-900 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Pair
                </button>
              </div>
            )}

            {allFixedPairs.length > 0 && (
              <div className="mt-4 grid gap-2">
                {allFixedPairs.map((pair) => (
                  <div
                    key={pair.id}
                    className="flex flex-col gap-2 rounded-xl border-2 border-slate-800 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-sm font-black uppercase text-slate-800">
                        {pair.playerIds.map(getPlayerName).join(' & ')}
                      </p>
                      <p className="mt-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                        {pair.playerIds.length === 2 ? 'Locked pair' : `${pair.playerIds.length} players assigned`}
                      </p>
                    </div>
                    {status === 'setup' && isOwner && (
                      <button
                        type="button"
                        onClick={() => clearFixedPair(pair.id)}
                        disabled={busyPlayerId === `pair-${pair.id}`}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border-2 border-slate-800 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-700 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] disabled:opacity-50"
                      >
                        <Unlink2 className="h-3.5 w-3.5" />
                        Unpair
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {canAddPlayers && currentUser && (
          <div className="mb-4 rounded-2xl border-2 border-sky-200 bg-sky-50 px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-sky-800">
                  {claimedPlayer ? 'You are linked to this tournament roster.' : 'Link yourself to the roster.'}
                </p>
                <p className="mt-1 text-xs font-bold text-sky-700">
                  {claimedPlayer
                    ? `${claimedPlayer.name} is claimed by ${currentUserEmail || currentUserName}.`
                    : suggestedClaimPlayer
                      ? status === 'setup'
                        ? `We found "${suggestedClaimPlayer.name}" in the roster. Claim it, or add yourself as a new player.`
                        : `We found "${suggestedClaimPlayer.name}" in the roster. Claim it to link this tournament to your profile.`
                      : status === 'setup'
                        ? 'Add yourself as a claimed player so your tournament identity is tied to your login.'
                        : 'Kickoff has already happened, so new players are locked. You can still claim your existing roster name.'}
                </p>
              </div>
              {!claimedPlayer && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  {suggestedClaimPlayer && (
                    <button
                      onClick={() => claimPlayer(suggestedClaimPlayer)}
                      disabled={busyPlayerId === suggestedClaimPlayer.id}
                      className="rounded-xl border-2 border-slate-800 bg-white px-4 py-2 text-[10px] font-black uppercase shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] disabled:opacity-50"
                    >
                      {busyPlayerId === suggestedClaimPlayer.id ? 'Claiming...' : 'Claim My Name'}
                    </button>
                  )}
                  {status === 'setup' && (
                    <button
                      onClick={addSelf}
                      disabled={busyPlayerId === 'self'}
                      className="rounded-xl border-2 border-slate-800 bg-sky-400 px-4 py-2 text-[10px] font-black uppercase text-slate-900 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] disabled:opacity-50"
                    >
                      {busyPlayerId === 'self' ? 'Adding...' : 'Add Me'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {status === 'setup' && canAddPlayers && (
          <div className="flex flex-col sm:flex-row gap-4 mb-8">
            <input 
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addPlayer()}
              placeholder="Athlete Name..."
              className="brutal-input flex-1"
            />
            <button 
              onClick={addPlayer}
              className="brutal-button-lime"
            >
              <div className="flex items-center justify-center gap-2">
                <UserPlus className="w-5 h-5" />
                <span>ROSTER+</span>
              </div>
            </button>
          </div>
        )}

        {error && (
          <div className="mb-6 bg-orange-50 border-2 border-orange-200 text-orange-700 px-4 py-3 rounded-xl font-bold text-sm">
            {error}
          </div>
        )}

        {status === 'setup' && isOwner && (
          <button 
            onClick={onStart}
            disabled={!canStartTournament}
            className={`w-full flex items-center justify-center gap-3 text-xl py-5 transition-all ${
              canStartTournament
              ? 'brutal-button-orange' 
              : 'bg-slate-50 border-4 border-slate-100 text-slate-300 rounded-2xl cursor-not-allowed font-black uppercase'
            }`}
          >
            <PlayCircle className="w-6 h-6" />
            KICK OFF TOURNAMENT ({players.length}/{minimumPlayers}+ READY)
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-24">
        <AnimatePresence>
          {players.map(p => (
            <motion.div 
              key={p.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white border-2 border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-[3px_3px_0px_0px_rgba(30,41,59,1)]"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-lime-100 flex items-center justify-center border-2 border-slate-800">
                  <UserPlus className="w-5 h-5 text-lime-600" />
                </div>
                <div>
                  <span className="flex items-center gap-1.5 font-black text-slate-800 uppercase tracking-tight">
                    <span>{p.name}</span>
                    {p.claimedByUserId && (
                      <span
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 text-white"
                        title={p.claimedByUserId === currentUser?.uid ? 'Verified: You' : 'Verified player'}
                      >
                        <BadgeCheck className="h-3 w-3" />
                      </span>
                    )}
                  </span>
                  {isFixedPairMode && (
                    <span className="mt-1 block text-[9px] font-black uppercase tracking-[0.14em] text-orange-500">
                      {p.fixedPairId
                        ? `Pair: ${players.filter((player) => player.fixedPairId === p.fixedPairId).map((player) => player.name).join(' & ')}`
                        : 'Needs partner'}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {canAddPlayers && currentUser && !claimedPlayer && !p.claimedByUserId && (
                  <button
                    onClick={() => claimPlayer(p)}
                    disabled={busyPlayerId === p.id}
                    className="rounded-xl border-2 border-slate-800 bg-white px-3 py-2 text-[10px] font-black uppercase shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] disabled:opacity-50"
                    title="Claim Player"
                  >
                    {busyPlayerId === p.id ? 'Claiming...' : 'Claim'}
                  </button>
                )}
                {isOwner && status === 'setup' && (
                  <button 
                    onClick={() => removePlayer(p.id)}
                    className="p-2 border-2 border-slate-800 rounded-xl text-slate-300 hover:text-orange-500 hover:border-orange-500 hover:bg-orange-50 transition-all shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] active:translate-y-0.5 active:shadow-none"
                    title="Remove Player"
                  >
                    <UserMinus className="w-5 h-5" />
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {players.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 text-center">
          <UserPlus className="mx-auto h-10 w-10 text-lime-500" />
          <h3 className="mt-4 text-lg font-black uppercase text-slate-800">Roster is empty</h3>
          <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
            Add yourself or type player names to get this mixer ready.
          </p>
          {canAddPlayers && currentUser && status === 'setup' && (
            <button
              type="button"
              onClick={addSelf}
              disabled={busyPlayerId === 'self'}
              className="mt-5 brutal-button-lime text-xs disabled:opacity-50"
            >
              {busyPlayerId === 'self' ? 'Adding...' : 'Add Me'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
