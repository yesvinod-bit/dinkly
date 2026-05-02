import React, { useState } from 'react';
import { Player } from '../lib/firebase';
import type { SessionAbsence } from '../lib/firebase';
import { getFixedPairs, buildSessionName } from '../lib/tournamentLogic';
import { CalendarDays, UserMinus, X, UserCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  players: Player[];
  sessionNumber: number;
  isCreating: boolean;
  onConfirm: (name: string, absences: Record<string, SessionAbsence>) => Promise<void>;
  onCancel: () => void;
}

export default function SessionManager({ players, sessionNumber, isCreating, onConfirm, onCancel }: Props) {
  const [sessionName, setSessionName] = useState(() => buildSessionName(sessionNumber));
  const [absences, setAbsences] = useState<Record<string, SessionAbsence>>({});

  const fixedPairs = getFixedPairs(players);
  const playerById = new Map(players.map((p) => [p.id, p]));

  const toggleAbsent = (playerId: string) => {
    setAbsences((prev) => {
      if (playerId in prev) {
        const next = { ...prev };
        delete next[playerId];
        return next;
      }
      return { ...prev, [playerId]: { subName: null } };
    });
  };

  const setSubName = (playerId: string, subName: string) => {
    setAbsences((prev) => ({
      ...prev,
      [playerId]: { subName: subName.trim() || null },
    }));
  };

  const sittingOutPairCount = fixedPairs.filter((pair) =>
    pair.playerIds.some((id) => id in absences && absences[id].subName === null)
  ).length;

  const playingPairCount = fixedPairs.length - sittingOutPairCount;

  const handleConfirm = async () => {
    await onConfirm(sessionName.trim() || buildSessionName(sessionNumber), absences);
  };

  return (
    <motion.div
      className="fixed inset-0 z-[260] flex items-end justify-center bg-slate-950/45 p-3 backdrop-blur-sm sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 360, damping: 28 }}
        className="w-full max-w-md rounded-3xl border-4 border-slate-900 bg-white p-4 shadow-[8px_8px_0px_0px_rgba(30,41,59,1)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-slate-800 bg-lime-400">
              <CalendarDays className="h-5 w-5 text-slate-900" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-lime-700">League</p>
              <h2 className="text-lg font-black uppercase leading-tight text-slate-900">
                Start Session {sessionNumber}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border-2 border-slate-800 bg-white p-2 text-slate-500 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4">
          <label className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600">Session Name</label>
          <input
            type="text"
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            className="brutal-input mt-1 w-full text-sm"
            placeholder={buildSessionName(sessionNumber)}
          />
        </div>

        <div className="mt-4">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600">
            Roster — mark absent players
          </p>
          <div className="mt-2 space-y-2 max-h-64 overflow-y-auto">
            <AnimatePresence initial={false}>
              {fixedPairs.map((pair) => {
                const pairAbsences = pair.playerIds.filter((id) => id in absences);
                const sitsOut = pairAbsences.some((id) => absences[id].subName === null);

                return (
                  <div
                    key={pair.id}
                    className={`rounded-2xl border-2 p-3 transition-colors ${
                      sitsOut
                        ? 'border-orange-300 bg-orange-50'
                        : pairAbsences.length > 0
                          ? 'border-sky-300 bg-sky-50'
                          : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-black uppercase text-slate-700">{pair.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${
                        sitsOut
                          ? 'bg-orange-200 text-orange-800'
                          : pairAbsences.length > 0
                            ? 'bg-sky-200 text-sky-800'
                            : 'bg-lime-200 text-lime-800'
                      }`}>
                        {sitsOut ? 'Sits out' : pairAbsences.length > 0 ? 'Has sub' : 'Playing'}
                      </span>
                    </div>

                    <div className="mt-2 space-y-2">
                      {pair.playerIds.map((playerId) => {
                        const player = playerById.get(playerId);
                        if (!player) return null;
                        const isAbsent = playerId in absences;
                        const subName = absences[playerId]?.subName ?? '';

                        return (
                          <div key={playerId}>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => toggleAbsent(playerId)}
                                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 border-slate-800 transition-colors ${
                                  isAbsent ? 'bg-orange-400 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                                }`}
                                title={isAbsent ? 'Mark present' : 'Mark absent'}
                              >
                                {isAbsent ? <UserMinus className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                              </button>
                              <span className={`text-[11px] font-black uppercase ${isAbsent ? 'text-orange-700 line-through' : 'text-slate-800'}`}>
                                {player.name}
                              </span>
                              {isAbsent && (
                                <span className="text-[9px] font-bold uppercase text-orange-500">absent</span>
                              )}
                            </div>
                            {isAbsent && (
                              <div className="ml-9 mt-1.5">
                                <input
                                  type="text"
                                  value={subName}
                                  onChange={(e) => setSubName(playerId, e.target.value)}
                                  placeholder="Sub name (leave blank to sit out)"
                                  className="w-full rounded-lg border-2 border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 placeholder:text-slate-300 focus:border-slate-800 focus:outline-none"
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-600">
          {playingPairCount} pair{playingPairCount !== 1 ? 's' : ''} playing
          {sittingOutPairCount > 0 && (
            <span className="ml-2 text-orange-600">
              · {sittingOutPairCount} sitting out
            </span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-12 rounded-xl border-2 border-slate-800 bg-white px-3 text-[10px] font-black uppercase text-slate-800 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isCreating || playingPairCount < 2}
            className="min-h-12 rounded-xl border-2 border-slate-800 bg-lime-400 px-3 text-[10px] font-black uppercase text-slate-900 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] disabled:opacity-50"
          >
            {isCreating ? 'Starting...' : 'Start Session'}
          </button>
        </div>
        {playingPairCount < 2 && (
          <p className="mt-2 text-center text-[10px] font-bold uppercase text-orange-600">
            Need at least 2 pairs playing to start.
          </p>
        )}
      </motion.div>
    </motion.div>
  );
}
