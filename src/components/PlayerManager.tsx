import React, { useState } from 'react';
import { 
  collection, 
  addDoc, 
  deleteDoc, 
  doc, 
  updateDoc,
  serverTimestamp 
} from 'firebase/firestore';
import { auth, db, Player, TournamentFormat, getReadableFirestoreError } from '../lib/firebase';
import { getMinimumPlayers, getTournamentFormat } from '../lib/tournamentLogic';
import { BadgeCheck, Plus, UserMinus, UserPlus, PlayCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  tournamentId: string;
  players: Player[];
  format?: TournamentFormat;
  canAddPlayers: boolean;
  isOwner: boolean;
  status: string;
  onStart: () => void;
}

export default function PlayerManager({ tournamentId, players, format, canAddPlayers, isOwner, status, onStart }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyPlayerId, setBusyPlayerId] = useState<string | null>(null);
  const tournamentFormat = getTournamentFormat(format);
  const minimumPlayers = getMinimumPlayers(tournamentFormat);
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
        name,
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
      await deleteDoc(doc(db, 'tournaments', tournamentId, 'players', id));
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
            disabled={players.length < minimumPlayers}
            className={`w-full flex items-center justify-center gap-3 text-xl py-5 transition-all ${
              players.length >= minimumPlayers 
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
              className="bg-white border-4 border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-[4px_4px_0px_0px_rgba(30,41,59,1)]"
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
        <div className="p-16 brutal-card text-center italic text-slate-300 font-bold uppercase tracking-widest bg-slate-50 border-dashed border-4">
           Roster currently empty
        </div>
      )}
    </div>
  );
}
