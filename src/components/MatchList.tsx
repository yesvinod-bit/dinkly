import React, { useState } from 'react';
import { 
  doc, 
  updateDoc, 
  serverTimestamp, 
  writeBatch,
  increment 
} from 'firebase/firestore';
import { db, Player, Match, handleFirestoreError } from '../lib/firebase';
import { CheckCircle2, ChevronRight, User, Swords, Share2, RotateCcw } from 'lucide-react';
import { motion } from 'motion/react';

interface Props {
  tournamentId: string;
  tournamentName: string;
  matches: Match[];
  players: Player[];
  isOwner: boolean;
}

export default function MatchList({ tournamentId, tournamentName, matches, players, isOwner }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [score1, setScore1] = useState<string>('');
  const [score2, setScore2] = useState<string>('');

  const getPlayerName = (id: string) => players.find(p => p.id === id)?.name || 'Unknown';

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

  const submitScore = async (match: Match) => {
    const s1 = parseInt(score1) || 0;
    const s2 = parseInt(score2) || 0;
    
    try {
      const batch = writeBatch(db);
      const matchRef = doc(db, 'tournaments', tournamentId, 'matches', match.id);
      
      batch.update(matchRef, {
        score1: s1,
        score2: s2,
        status: 'completed',
        updatedAt: serverTimestamp()
      });

      // Update player stats
      const diff = Math.abs(s1 - s2);
      const winTeam = s1 > s2 ? 1 : 2;
      const winPlayers = winTeam === 1 ? match.team1 : match.team2;
      const losePlayers = winTeam === 1 ? match.team2 : match.team1;

      winPlayers.forEach(pid => {
        const pRef = doc(db, 'tournaments', tournamentId, 'players', pid);
        batch.update(pRef, {
          points: increment(diff),
          gamesPlayed: increment(1),
          wins: increment(1)
        });
      });

      losePlayers.forEach(pid => {
        const pRef = doc(db, 'tournaments', tournamentId, 'players', pid);
        batch.update(pRef, {
          points: increment(-diff),
          gamesPlayed: increment(1)
        });
      });

      await batch.commit();
      setEditingId(null);
    } catch (e) {
      handleFirestoreError(e, 'update');
    }
  };

  const undoScore = async (match: Match) => {
    if (!window.confirm('Are you sure you want to undo this score? This will revert player stats.')) return;

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
        updatedAt: serverTimestamp()
      });

      await batch.commit();
    } catch (e) {
      handleFirestoreError(e, 'update');
    }
  };

  const rounds = Array.from(new Set(matches.map(m => m.round))).sort((a, b) => b - a);

  return (
    <div className="space-y-12">
      {rounds.map(round => (
        <div key={round}>
          <div className="flex items-center gap-4 mb-6">
            <span className="bg-zinc-900 text-white px-3 py-1 rounded-full text-xs font-bold font-mono">RD {round}</span>
            <div className="h-px bg-zinc-100 flex-1" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {matches.filter(m => m.round === round).map((match) => (
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
                       {isOwner && (
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
                      <div key={pid} className="flex items-center gap-1.5 text-[11px] sm:text-lg font-black truncate text-slate-800">
                        <div className="w-4 h-4 sm:w-8 sm:h-8 rounded-md sm:rounded-lg bg-lime-100 border border-slate-800 flex items-center justify-center text-slate-800 shrink-0">
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
                      <div key={pid} className="flex items-center justify-end gap-1.5 text-[11px] sm:text-lg font-black truncate text-slate-800">
                        <span className="truncate">{getPlayerName(pid)}</span>
                        <div className="w-4 h-4 sm:w-8 sm:h-8 rounded-md sm:rounded-lg bg-orange-100 border border-slate-800 flex items-center justify-center text-slate-800 shrink-0">
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

                {match.status === 'pending' && (
                  <div className="mt-6 pt-4 border-t-2 border-dashed border-slate-200">
                    {editingId === match.id ? (
                      <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-center gap-2 w-full">
                          <div className="flex flex-col items-center gap-1 flex-1">
                            <span className="text-[9px] font-bold text-slate-400 uppercase">Team 1</span>
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
                              className="w-full h-10 brutal-input text-center text-lg p-0"
                            />
                          </div>
                          <span className="text-slate-800 font-black text-lg mt-3">:</span>
                          <div className="flex flex-col items-center gap-1 flex-1">
                            <span className="text-[9px] font-bold text-slate-400 uppercase">Team 2</span>
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
                              className="w-full h-10 brutal-input text-center text-lg p-0"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2 w-full">
                          <button 
                            onClick={() => setEditingId(null)}
                            className="flex-1 py-2 bg-zinc-100 border-2 border-slate-800 rounded-xl font-bold text-[10px]"
                          >
                            CANCEL
                          </button>
                          <button 
                            onClick={() => submitScore(match)}
                            className="flex-[2] brutal-button-orange py-2 px-6 whitespace-nowrap text-[10px] mb-0"
                          >
                            SAVE
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button 
                        onClick={() => { setEditingId(match.id); setScore1(''); setScore2(''); }}
                        className="w-full py-3 bg-lime-400 border-2 border-slate-800 rounded-xl shadow-[3px_3px_0px_0px_rgba(30,41,59,1)] font-black text-xs sm:text-sm flex items-center justify-center gap-2 group hover:translate-y-0.5 active:translate-y-1 active:shadow-none transition-all uppercase"
                      >
                        ENTER SCORE
                        <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </button>
                    )}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
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
    </div>
  );
}
