import React from 'react';
import { Match, Player } from '../lib/firebase';
import { Trophy, Medal, User, Users } from 'lucide-react';
import { motion } from 'motion/react';

interface Props {
  players: Player[];
  matches: Match[];
}

interface RankedPlayer extends Player {
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  averageDiff: number;
  headToHead: Map<string, number>;
}

export default function Leaderboard({ players, matches }: Props) {
  const rankedPlayers = players.map((player) => ({
    ...player,
    points: 0,
    gamesPlayed: 0,
    wins: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    pointDiff: 0,
    averageDiff: 0,
    headToHead: new Map<string, number>()
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

  const sortedPlayers = [...rankedPlayers].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;

    const headToHeadMargin = b.headToHead.get(a.id) || 0;
    if (headToHeadMargin !== 0) return headToHeadMargin;

    if (b.averageDiff !== a.averageDiff) return b.averageDiff - a.averageDiff;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;

    return a.name.localeCompare(b.name);
  });

  return (
    <div className="brutal-card overflow-hidden">
      <div className="p-6 border-b-4 border-slate-800 bg-lime-400">
        <h3 className="font-black text-lg md:text-2xl flex items-center gap-2 text-slate-800 italic uppercase">
          <Trophy className="w-5 h-5 md:w-6 md:h-6 text-slate-800" />
          STANDINGS
        </h3>
        <p className="mt-2 text-[10px] md:text-xs font-black uppercase tracking-widest text-slate-700">
          Tiebreakers: Point Diff, Head-to-Head, Avg Margin, Points Scored
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-slate-800 text-white text-[8px] sm:text-xs uppercase tracking-widest">
            <tr>
              <th className="px-3 sm:px-6 py-3 md:py-5 font-black">Rank</th>
              <th className="px-3 sm:px-6 py-3 md:py-5 font-black">Player</th>
              <th className="px-2 sm:px-6 py-3 md:py-5 font-black text-center"><span className="sm:hidden">GP</span><span className="hidden sm:inline">Played</span></th>
              <th className="px-2 sm:px-6 py-3 md:py-5 font-black text-center"><span className="sm:hidden">W</span><span className="hidden sm:inline">Wins</span></th>
              <th className="px-3 sm:px-6 py-3 md:py-5 font-black text-center">Diff</th>
              <th className="px-3 sm:px-6 py-3 md:py-5 font-black text-center hidden md:table-cell">For</th>
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-slate-100 font-bold">
            {sortedPlayers.map((player, idx) => (
              <motion.tr 
                key={player.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className={`${idx === 0 ? 'bg-lime-50' : 'hover:bg-zinc-50'} transition-colors`}
              >
                <td className="px-3 sm:px-6 py-3 md:py-5">
                  <div className="flex items-center gap-1.5 md:gap-2">
                    {idx === 0 && <Medal className="w-4 h-4 md:w-5 md:h-5 text-orange-500 shrink-0" />}
                    <span className={`font-mono text-sm md:text-lg ${idx === 0 ? 'text-lime-600 font-black' : 'text-slate-400 font-bold'}`}>
                      #{idx + 1}
                    </span>
                  </div>
                </td>
                <td className="px-3 sm:px-6 py-3 md:py-5">
                  <div className="flex items-center gap-2 md:gap-3">
                    <div className="w-6 h-6 md:w-8 md:h-8 rounded-md md:rounded-lg bg-white border border-slate-800 flex items-center justify-center text-slate-800 shrink-0 hidden xs:flex">
                      <User className="w-3 h-3 md:w-4 md:h-4" />
                    </div>
                    <span className="font-black text-slate-800 text-xs md:text-lg uppercase tracking-tight truncate max-w-[60px] sm:max-w-none">{player.name}</span>
                  </div>
                </td>
                <td className="px-2 sm:px-6 py-3 md:py-5 text-center text-xs md:text-lg text-slate-600 italic">{player.gamesPlayed}</td>
                <td className="px-2 sm:px-6 py-3 md:py-5 text-center font-black text-lg md:text-2xl text-slate-800">{player.wins}</td>
                <td className={`px-3 sm:px-6 py-3 md:py-5 text-center font-mono text-lg md:text-2xl font-black ${player.pointDiff >= 0 ? 'text-orange-500' : 'text-slate-400'}`}>
                  {player.pointDiff >= 0 ? `+${player.pointDiff}` : player.pointDiff}
                </td>
                <td className="px-3 sm:px-6 py-3 md:py-5 text-center font-mono text-sm md:text-lg text-slate-500 hidden md:table-cell">
                  {player.pointsFor}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
        {players.length === 0 && (
          <div className="p-16 text-center bg-white">
            <Users className="w-16 h-16 text-lime-200 mx-auto mb-4 border-4 border-lime-100 rounded-2xl p-2" />
            <p className="text-slate-400 font-black uppercase tracking-widest">No Competitors Yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
