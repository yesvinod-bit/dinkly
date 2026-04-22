import React, { useState } from 'react';
import { 
  collection, 
  addDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp 
} from 'firebase/firestore';
import { db, Player } from '../lib/firebase';
import { Plus, UserMinus, UserPlus, PlayCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  tournamentId: string;
  players: Player[];
  isOwner: boolean;
  status: string;
  onStart: () => void;
}

export default function PlayerManager({ tournamentId, players, isOwner, status, onStart }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

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
      setError('Unable to add player right now.');
    }
  };

  const removePlayer = async (id: string) => {
    if (!confirm('Remove player?')) return;
    setError(null);
    try {
      await deleteDoc(doc(db, 'tournaments', tournamentId, 'players', id));
    } catch (e) {
      console.error(e);
      setError('Unable to remove player. Make sure the tournament is still in setup mode.');
    }
  };

  return (
    <div className="space-y-8">
      <div className="brutal-card p-6 sm:p-8">
        <h2 className="text-2xl font-black mb-2 text-slate-800 uppercase italic">RECRUIT PLAYERS</h2>
        <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest mb-6">Setup Phase: Add at least 4 participants</p>
        
        {isOwner && status === 'setup' && (
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
            disabled={players.length < 4}
            className={`w-full flex items-center justify-center gap-3 text-xl py-5 transition-all ${
              players.length >= 4 
              ? 'brutal-button-orange' 
              : 'bg-slate-50 border-4 border-slate-100 text-slate-300 rounded-2xl cursor-not-allowed font-black uppercase'
            }`}
          >
            <PlayCircle className="w-6 h-6" />
            KICK OFF TOURNAMENT ({players.length}/4+ READY)
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
                <span className="font-black text-slate-800 uppercase tracking-tight">{p.name}</span>
              </div>
              {isOwner && status === 'setup' && (
                <button 
                  onClick={() => removePlayer(p.id)}
                  className="p-2 border-2 border-slate-800 rounded-xl text-slate-300 hover:text-orange-500 hover:border-orange-500 hover:bg-orange-50 transition-all shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] active:translate-y-0.5 active:shadow-none"
                  title="Remove Player"
                >
                  <UserMinus className="w-5 h-5" />
                </button>
              )}
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
