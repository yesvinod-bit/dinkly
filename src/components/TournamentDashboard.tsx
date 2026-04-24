import React, { useState, useEffect } from 'react';
import { 
  doc, 
  onSnapshot, 
  collection, 
  query, 
  orderBy, 
  updateDoc, 
  addDoc, 
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { 
  db, 
  auth, 
  Tournament, 
  TournamentFormat,
  Player, 
  Match, 
  getReadableFirestoreError
} from '../lib/firebase';
import { generateRoundMatches, getMinimumPlayers, getTournamentFormat, getTournamentFormatTag } from '../lib/tournamentLogic';
import { 
  Trophy, 
  Users, 
  Play, 
  Plus, 
  Share2, 
  ChevronLeft, 
  RotateCcw,
  AlertTriangle,
  Loader2
} from 'lucide-react';
import Leaderboard from './Leaderboard';
import MatchList from './MatchList';
import PlayerManager from './PlayerManager';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  tournamentId: string;
  readOnly?: boolean;
  onBack: () => void;
}

export default function TournamentDashboard({ tournamentId, readOnly = false, onBack }: Props) {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [tab, setTab] = useState<'matches' | 'leaderboard' | 'setup'>('matches');
  const [loading, setLoading] = useState(true);
  const [roundActionError, setRoundActionError] = useState<string | null>(null);
  const [isGeneratingRound, setIsGeneratingRound] = useState(false);
  const [isTournamentMember, setIsTournamentMember] = useState(false);

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

    return () => { unsubT(); unsubP(); unsubM(); };
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
  const canManageTournament = isOwner && !readOnly;
  const canContributePlayers = !readOnly && (isOwner || isTournamentMember);
  const showSetupTab = !readOnly && tournament?.status === 'setup' && (isOwner || isTournamentMember);
  const tournamentFormat: TournamentFormat = getTournamentFormat(tournament?.format);
  const tournamentFormatTag = getTournamentFormatTag(tournamentFormat);
  const minimumPlayers = getMinimumPlayers(tournamentFormat);

  const startTournament = async () => {
    if (!canManageTournament) return;
    setRoundActionError(null);
    if (players.length < minimumPlayers) {
      return alert(`Need at least ${minimumPlayers} players for a ${tournamentFormat} tournament!`);
    }
    try {
      await updateDoc(doc(db, 'tournaments', tournamentId), { status: 'active' });
      setTab('matches');
      await generateNextRound();
    } catch (e) {
      const message = getReadableFirestoreError(e, 'Unable to start the tournament right now.');
      setRoundActionError(message);
    }
  };

  const generateNextRound = async () => {
    if (!canManageTournament) return;
    setRoundActionError(null);
    setIsGeneratingRound(true);

    try {
      const pendingMatches = matches.filter((match) => match.status === 'pending');
      if (pendingMatches.length > 0) {
        setRoundActionError('Finish scoring the current round before generating the next one.');
        return;
      }

      if (players.length < minimumPlayers) {
        setRoundActionError(`You need at least ${minimumPlayers} players for a ${tournamentFormat} round.`);
        return;
      }

      const currentRound = matches.length > 0 ? Math.max(...matches.map(m => m.round)) : 0;
      const nextRound = currentRound + 1;
      const roundMatches = generateRoundMatches(players, nextRound, tournamentFormat);

      if (roundMatches.length === 0) {
        setRoundActionError(`No ${tournamentFormat} matches could be generated from the current roster.`);
        return;
      }
      
      const batch = writeBatch(db);
      roundMatches.forEach(m => {
        const ref = doc(collection(db, 'tournaments', tournamentId, 'matches'));
        batch.set(ref, { ...m, updatedAt: serverTimestamp(), completedAt: null });
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

  const shareCode = () => {
    let url = window.location.href;
    if (url.includes('ais-dev-')) {
      url = url.replace('ais-dev-', 'ais-pre-');
    }

    if (navigator.share) {
      navigator.share({
        title: '🏓 Let\'s play Pickleball on Dinkly!',
        text: `Ready to dink? Join my random tournament "${tournament?.name}" on Dinkly! We use this app to manage pairings and track live scores in real-time. 🔥\n\nAccess Code: ${tournament?.code}`,
        url: url
      });
    } else {
      navigator.clipboard.writeText(url);
      alert('Link copied!');
    }
  };

  if (loading) return null;

  return (
    <div className="min-h-screen bg-lime-50 flex flex-col">
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
                <span className="text-[8px] font-bold uppercase text-lime-700 bg-lime-100 px-1.5 py-0.5 rounded-md border border-lime-200">
                  {tournament?.status}
                </span>
                <span className="inline-flex items-center gap-1 rounded-md border border-orange-300 bg-orange-100 px-2 py-0.5 text-[8px] font-black uppercase text-orange-700">
                  <span>{tournamentFormatTag.label}</span>
                  <span className="text-orange-500">•</span>
                  <span>{tournamentFormatTag.detail}</span>
                </span>
              </div>
            </div>
          </div>
          <button 
            onClick={shareCode} 
            className="p-2 md:p-3 bg-orange-500 text-white rounded-xl md:rounded-2xl border-2 border-slate-800 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] md:shadow-[4px_4px_0px_0px_rgba(30,41,59,1)] hover:translate-y-0.5 transition-all"
          >
            <Share2 className="w-4 h-4 md:w-5 md:h-5" />
          </button>
        </div>
      </header>

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
                canAddPlayers={canContributePlayers}
                isOwner={canManageTournament}
                status={tournament?.status || 'setup'}
                onStart={startTournament}
              />
            </motion.div>
          )}

          {tab === 'matches' && (
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
              <div className="flex items-center justify-between mb-6 md:mb-8">
                <h2 className="text-xl md:text-3xl font-black text-slate-800">COURT TRACKER</h2>
                {canManageTournament && tournament?.status === 'active' && (
                  <button 
                    onClick={generateNextRound}
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
                readOnly={readOnly}
              />
            </motion.div>
          )}

          {tab === 'leaderboard' && (
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
              <Leaderboard players={players} matches={matches} />
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
               {window.location.origin.replace('ais-dev-', 'ais-pre-')}?view={tournamentId}
             </code>
             <button
               onClick={() => {
                 const spectatorUrl = `${window.location.origin.replace('ais-dev-', 'ais-pre-')}?view=${tournamentId}`;
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
