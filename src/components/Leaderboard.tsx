import React, { useState } from 'react';
import { Match, Player, Session, TournamentFormat, TournamentPairingMode } from '../lib/firebase';
import {
  filterMatchesBySession,
  getFixedPairStandings,
  getTournamentFormat,
  getTournamentPairingMode
} from '../lib/tournamentLogic';
import { CheckSquare, Crown, Medal, PlayCircle, Sparkles, Square, Trophy, User, Users, CalendarDays } from 'lucide-react';
import { motion } from 'motion/react';

interface Props {
  players: Player[];
  matches: Match[];
  format?: TournamentFormat;
  pairingMode?: TournamentPairingMode;
  canManageTournament?: boolean;
  isCreatingPlayoffRound?: boolean;
  playoffActionError?: string | null;
  onCreatePlayoffRound?: (pairIds: string[]) => Promise<void> | void;
  onCreateNextPlayoffRound?: () => Promise<void> | void;
  sessions?: Session[];
  currentSession?: Session | null;
}

interface RankedStanding {
  id: string;
  name: string;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  points: number;
  gamesPlayed: number;
  wins: number;
  averageDiff: number;
  headToHead: Map<string, number>;
  seed?: number;
}

function buildPlayerStandings(players: Player[], matches: Match[]): RankedStanding[] {
  const rankedPlayers: RankedStanding[] = players.map((player) => ({
    id: player.id,
    name: player.name,
    points: 0,
    gamesPlayed: 0,
    wins: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    pointDiff: 0,
    averageDiff: 0,
    headToHead: new Map<string, number>(),
  }));
  const playerMap = new Map(rankedPlayers.map((player) => [player.id, player]));

  matches
    .filter((match) => match.status === 'completed')
    .forEach((match) => {
      const team1Won = match.score1 > match.score2;

      match.team1.forEach((playerId) => {
        const player = playerMap.get(playerId);
        if (!player) return;
        player.gamesPlayed += 1;
        if (team1Won) player.wins += 1;
        player.pointsFor += match.score1;
        player.pointsAgainst += match.score2;
      });

      match.team2.forEach((playerId) => {
        const player = playerMap.get(playerId);
        if (!player) return;
        player.gamesPlayed += 1;
        if (!team1Won) player.wins += 1;
        player.pointsFor += match.score2;
        player.pointsAgainst += match.score1;
      });

      match.team1.forEach((team1PlayerId) => {
        match.team2.forEach((team2PlayerId) => {
          const team1Player = playerMap.get(team1PlayerId);
          const team2Player = playerMap.get(team2PlayerId);
          if (!team1Player || !team2Player) return;

          const margin = match.score1 - match.score2;
          team1Player.headToHead.set(
            team2PlayerId,
            (team1Player.headToHead.get(team2PlayerId) || 0) + margin
          );
          team2Player.headToHead.set(
            team1PlayerId,
            (team2Player.headToHead.get(team1PlayerId) || 0) - margin
          );
        });
      });
    });

  rankedPlayers.forEach((player) => {
    player.pointDiff = player.pointsFor - player.pointsAgainst;
    player.points = player.pointDiff;
    player.averageDiff = player.gamesPlayed > 0 ? player.pointDiff / player.gamesPlayed : 0;
  });

  return [...rankedPlayers].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;

    const headToHeadMargin = b.headToHead.get(a.id) || 0;
    if (headToHeadMargin !== 0) return headToHeadMargin;

    if (b.averageDiff !== a.averageDiff) return b.averageDiff - a.averageDiff;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;

    return a.name.localeCompare(b.name);
  }).map((standing, index) => ({ ...standing, seed: index + 1 }));
}

export default function Leaderboard({
  players,
  matches,
  format,
  pairingMode,
  canManageTournament = false,
  isCreatingPlayoffRound = false,
  playoffActionError = null,
  onCreatePlayoffRound,
  onCreateNextPlayoffRound,
  sessions = [],
  currentSession = null,
}: Props) {
  const [selectedPairIds, setSelectedPairIds] = useState<string[]>([]);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [standingsView, setStandingsView] = useState<'season' | 'session'>('season');
  const tournamentFormat = getTournamentFormat(format);
  const tournamentPairingMode = getTournamentPairingMode(pairingMode, tournamentFormat);
  const isFixedPairLeaderboard = tournamentFormat === 'doubles' && tournamentPairingMode === 'fixed';
  const isLeague = sessions.length > 0;
  const playoffStarted = matches.some((match) => match.stage === 'playoff');

  const standingsMatches = standingsView === 'session' && currentSession
    ? filterMatchesBySession(matches, currentSession)
    : matches;

  const preliminaryStandings = isFixedPairLeaderboard
    ? getFixedPairStandings(players, standingsMatches, 'preliminary').map((standing) => ({
        ...standing,
        name: standing.label,
      }))
    : buildPlayerStandings(players, standingsMatches);
  const playoffStandings = isFixedPairLeaderboard
    ? getFixedPairStandings(players, matches, 'playoff')
        .filter((standing) => standing.gamesPlayed > 0)
        .map((standing) => ({ ...standing, name: standing.label }))
    : [];
  const canSelectPlayoffPairs = isFixedPairLeaderboard && canManageTournament && !playoffStarted;

  const toggleSelectedPair = (pairId: string) => {
    setSelectionError(null);
    setSelectedPairIds((current) => (
      current.includes(pairId)
        ? current.filter((id) => id !== pairId)
        : [...current, pairId]
    ));
  };

  const selectTopPairs = (count: number) => {
    setSelectionError(null);
    setSelectedPairIds(preliminaryStandings.slice(0, count).map((standing) => standing.id));
  };

  const createPlayoffRound = async () => {
    if (!onCreatePlayoffRound) return;
    if (selectedPairIds.length < 2) {
      setSelectionError('Select at least 2 pairs for the playoff.');
      return;
    }
    if (selectedPairIds.length % 2 !== 0) {
      setSelectionError('Select an even number of pairs before creating playoffs.');
      return;
    }

    setSelectionError(null);
    await onCreatePlayoffRound(selectedPairIds);
  };

  const renderStandingCard = ({
    rows,
    title,
    subtitle,
    competitorLabel,
    selectable = false,
  }: {
    rows: RankedStanding[];
    title: string;
    subtitle: string;
    competitorLabel: string;
    selectable?: boolean;
  }) => (
    <div className="brutal-card overflow-hidden">
      <div className="p-6 border-b-4 border-slate-800 bg-lime-400">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="font-black text-lg md:text-2xl flex items-center gap-2 text-slate-800 italic uppercase">
              <Trophy className="w-5 h-5 md:w-6 md:h-6 text-slate-800" />
              {title}
            </h3>
            <p className="mt-2 text-[10px] md:text-xs font-black uppercase tracking-widest text-slate-700">
              {subtitle}
            </p>
          </div>
          {selectable && (
            <div className="flex flex-wrap gap-2">
              {preliminaryStandings.length >= 4 && (
                <button
                  type="button"
                  onClick={() => selectTopPairs(4)}
                  className="rounded-xl border-2 border-slate-800 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-700 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)]"
                >
                  Top 4
                </button>
              )}
              {preliminaryStandings.length >= 8 && (
                <button
                  type="button"
                  onClick={() => selectTopPairs(8)}
                  className="rounded-xl border-2 border-slate-800 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-700 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)]"
                >
                  Top 8
                </button>
              )}
              <button
                type="button"
                onClick={createPlayoffRound}
                disabled={isCreatingPlayoffRound}
                className="rounded-xl border-2 border-slate-800 bg-orange-500 px-3 py-2 text-[10px] font-black uppercase text-white shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-1.5">
                  <PlayCircle className="h-3.5 w-3.5" />
                  {isCreatingPlayoffRound ? 'Creating...' : `Create Playoff (${selectedPairIds.length})`}
                </span>
              </button>
            </div>
          )}
          {isFixedPairLeaderboard && playoffStarted && canManageTournament && title === 'PRELIMINARY STANDINGS' && (
            <button
              type="button"
              onClick={onCreateNextPlayoffRound}
              disabled={isCreatingPlayoffRound}
              className="rounded-xl border-2 border-slate-800 bg-orange-500 px-3 py-2 text-[10px] font-black uppercase text-white shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] disabled:opacity-50"
            >
              <span className="inline-flex items-center gap-1.5">
                <PlayCircle className="h-3.5 w-3.5" />
                {isCreatingPlayoffRound ? 'Creating...' : 'Next Playoff Round'}
              </span>
            </button>
          )}
        </div>
        {(selectionError || playoffActionError) && title !== 'PLAYOFF STANDINGS' && (
          <div className="mt-4 rounded-xl border-2 border-orange-200 bg-orange-50 px-4 py-3 text-sm font-bold text-orange-700">
            {selectionError || playoffActionError}
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-slate-800 text-white text-[8px] sm:text-xs uppercase tracking-widest">
            <tr>
              {selectable && <th className="px-3 sm:px-6 py-3 md:py-5 font-black">Pick</th>}
              <th className="px-3 sm:px-6 py-3 md:py-5 font-black">Rank</th>
              <th className="px-3 sm:px-6 py-3 md:py-5 font-black">{competitorLabel}</th>
              <th className="px-2 sm:px-6 py-3 md:py-5 font-black text-center"><span className="sm:hidden">GP</span><span className="hidden sm:inline">Played</span></th>
              <th className="px-2 sm:px-6 py-3 md:py-5 font-black text-center"><span className="sm:hidden">W</span><span className="hidden sm:inline">Wins</span></th>
              <th className="px-3 sm:px-6 py-3 md:py-5 font-black text-center">Diff</th>
              <th className="px-3 sm:px-6 py-3 md:py-5 font-black text-center hidden md:table-cell">For</th>
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-slate-100 font-bold">
            {rows.map((standing, idx) => {
              const isSelected = selectedPairIds.includes(standing.id);
              return (
              <motion.tr
                key={standing.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className={`${idx === 0 ? 'champion-row bg-lime-50' : 'hover:bg-zinc-50'} transition-colors`}
              >
                {selectable && (
                  <td className="px-3 sm:px-6 py-3 md:py-5">
                    <button
                      type="button"
                      onClick={() => toggleSelectedPair(standing.id)}
                      className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border-2 border-slate-800 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)] ${
                        isSelected ? 'bg-orange-500 text-white' : 'bg-white text-slate-500'
                      }`}
                      title={isSelected ? 'Remove from playoff' : 'Send to playoff'}
                    >
                      {isSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    </button>
                  </td>
                )}
                <td className="px-3 sm:px-6 py-3 md:py-5">
                  <div className="flex items-center gap-1.5 md:gap-2">
                    {idx === 0 && (
                      <span className="champion-medal relative inline-flex">
                        <Medal className="w-4 h-4 md:w-5 md:h-5 text-orange-500 shrink-0" />
                      </span>
                    )}
                    <span className={`font-mono text-sm md:text-lg ${idx === 0 ? 'text-lime-600 font-black' : 'text-slate-400 font-bold'}`}>
                      #{idx + 1}
                    </span>
                  </div>
                </td>
                <td className="px-3 sm:px-6 py-3 md:py-5">
                  <div className="flex items-center gap-2 md:gap-3">
                    <div className={`w-6 h-6 md:w-8 md:h-8 rounded-md md:rounded-lg bg-white border border-slate-800 flex items-center justify-center text-slate-800 shrink-0 hidden xs:flex ${
                      idx === 0 ? 'champion-avatar' : ''
                    }`}>
                      {idx === 0 ? <Crown className="w-3 h-3 md:w-4 md:h-4 text-orange-500" /> : <User className="w-3 h-3 md:w-4 md:h-4" />}
                    </div>
                    <span className={`font-black text-slate-800 text-xs md:text-lg uppercase tracking-tight truncate max-w-[60px] sm:max-w-none ${
                      idx === 0 ? 'champion-name-dance inline-flex items-center gap-1.5 overflow-visible text-lime-900' : ''
                    }`}>
                      {idx === 0 && <Sparkles className="hidden h-3.5 w-3.5 shrink-0 text-orange-500 sm:inline" />}
                      {standing.name}
                      {idx === 0 && <span className="champion-tag hidden rounded-full border border-orange-300 bg-orange-100 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.14em] text-orange-700 sm:inline">First</span>}
                    </span>
                  </div>
                </td>
                <td className="px-2 sm:px-6 py-3 md:py-5 text-center text-xs md:text-lg text-slate-600 italic">{standing.gamesPlayed}</td>
                <td className="px-2 sm:px-6 py-3 md:py-5 text-center font-black text-lg md:text-2xl text-slate-800">{standing.wins}</td>
                <td className={`px-3 sm:px-6 py-3 md:py-5 text-center font-mono text-lg md:text-2xl font-black ${standing.pointDiff >= 0 ? 'text-orange-500' : 'text-slate-400'}`}>
                  {standing.pointDiff >= 0 ? `+${standing.pointDiff}` : standing.pointDiff}
                </td>
                <td className="px-3 sm:px-6 py-3 md:py-5 text-center font-mono text-sm md:text-lg text-slate-500 hidden md:table-cell">
                  {standing.pointsFor}
                </td>
              </motion.tr>
            );})}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="p-16 text-center bg-white">
            <Users className="w-16 h-16 text-lime-200 mx-auto mb-4 border-4 border-lime-100 rounded-2xl p-2" />
            <p className="text-slate-400 font-black uppercase tracking-widest">No Competitors Yet</p>
          </div>
        )}
      </div>
    </div>
  );

  if (isFixedPairLeaderboard) {
    return (
      <div className="space-y-6">
        {isLeague && sessions.length >= 1 && !playoffStarted && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-2xl border-2 border-slate-800 bg-white p-1 shadow-[2px_2px_0px_0px_rgba(30,41,59,1)]">
              <CalendarDays className="ml-2 h-4 w-4 text-slate-500" />
              <button
                type="button"
                onClick={() => setStandingsView('season')}
                className={`rounded-xl px-3 py-2 text-[10px] font-black uppercase transition-all ${
                  standingsView === 'season' ? 'bg-lime-400 text-slate-900 shadow-[1.5px_1.5px_0px_0px_rgba(30,41,59,1)]' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Season
              </button>
              <button
                type="button"
                onClick={() => setStandingsView('session')}
                className={`rounded-xl px-3 py-2 text-[10px] font-black uppercase transition-all ${
                  standingsView === 'session' ? 'bg-orange-500 text-white shadow-[1.5px_1.5px_0px_0px_rgba(30,41,59,1)]' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                This Session
              </button>
            </div>
            {currentSession && (
              <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                {currentSession.name}
              </span>
            )}
          </div>
        )}
        {renderStandingCard({
          rows: preliminaryStandings,
          title: playoffStarted
            ? 'PRELIMINARY STANDINGS'
            : standingsView === 'session' && isLeague
              ? 'SESSION STANDINGS'
              : 'PAIR STANDINGS',
          subtitle: playoffStarted
            ? 'Preliminary standings are frozen. Playoff standings track knockout results separately.'
            : standingsView === 'session' && isLeague
              ? `Results for ${currentSession?.name ?? 'current session'} only.`
              : isLeague
                ? 'Season totals across all sessions. Select pairs to start playoffs.'
                : 'Select an even number of fixed pairs to create a seeded knockout round.',
          competitorLabel: 'Pair',
          selectable: canSelectPlayoffPairs,
        })}
        {playoffStarted && renderStandingCard({
          rows: playoffStandings,
          title: 'PLAYOFF STANDINGS',
          subtitle: 'Net new standings from knockout games only.',
          competitorLabel: 'Pair',
        })}
      </div>
    );
  }

  return renderStandingCard({
    rows: preliminaryStandings,
    title: 'STANDINGS',
    subtitle: 'Tiebreakers: Point Diff, Head-to-Head, Avg Margin, Points Scored',
    competitorLabel: 'Player',
  });
}
