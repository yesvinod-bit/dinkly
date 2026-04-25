import type { Match, Player, TournamentFormat } from './firebase.ts';

export const DEFAULT_TOURNAMENT_FORMAT: TournamentFormat = 'doubles';

export function getTournamentFormat(format?: TournamentFormat | null): TournamentFormat {
  return format === 'singles' ? 'singles' : DEFAULT_TOURNAMENT_FORMAT;
}

export function getTournamentFormatTag(format?: TournamentFormat | null): { label: string; detail: string } {
  return getTournamentFormat(format) === 'singles'
    ? { label: 'Singles', detail: '1v1' }
    : { label: 'Doubles', detail: '2v2' };
}

export function getMinimumPlayers(format?: TournamentFormat | null): number {
  return getTournamentFormat(format) === 'singles' ? 2 : 4;
}

export interface RoundGenerationSummary {
  freshTeammatePairs: number;
  repeatTeammatePairs: number;
  freshOpponentPairs: number;
  repeatOpponentPairs: number;
  appearanceGap: number;
  summary: string;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('::');
}

function buildRoundGenerationSummary(
  matches: Partial<Match>[],
  existingMatches: Match[],
  format?: TournamentFormat | null
): RoundGenerationSummary {
  const activeHistory = existingMatches.filter((match) => match.status !== 'void');
  const teammateHistory = new Set<string>();
  const opponentHistory = new Set<string>();
  const appearanceCounts = new Map<string, number>();

  activeHistory.forEach((match) => {
    [...match.team1, ...match.team2].forEach((playerId) => {
      appearanceCounts.set(playerId, (appearanceCounts.get(playerId) || 0) + 1);
    });

    [match.team1, match.team2].forEach((team) => {
      for (let i = 0; i < team.length; i += 1) {
        for (let j = i + 1; j < team.length; j += 1) {
          teammateHistory.add(pairKey(team[i], team[j]));
        }
      }
    });

    match.team1.forEach((team1Player) => {
      match.team2.forEach((team2Player) => {
        opponentHistory.add(pairKey(team1Player, team2Player));
      });
    });
  });

  let freshTeammatePairs = 0;
  let repeatTeammatePairs = 0;
  let freshOpponentPairs = 0;
  let repeatOpponentPairs = 0;
  const projectedAppearances = new Map(appearanceCounts);

  matches.forEach((match) => {
    if (!match.team1 || !match.team2) return;

    [...match.team1, ...match.team2].forEach((playerId) => {
      projectedAppearances.set(playerId, (projectedAppearances.get(playerId) || 0) + 1);
    });

    [match.team1, match.team2].forEach((team) => {
      for (let i = 0; i < team.length; i += 1) {
        for (let j = i + 1; j < team.length; j += 1) {
          if (teammateHistory.has(pairKey(team[i], team[j]))) {
            repeatTeammatePairs += 1;
          } else {
            freshTeammatePairs += 1;
          }
        }
      }
    });

    match.team1.forEach((team1Player) => {
      match.team2.forEach((team2Player) => {
        if (opponentHistory.has(pairKey(team1Player, team2Player))) {
          repeatOpponentPairs += 1;
        } else {
          freshOpponentPairs += 1;
        }
      });
    });
  });

  const projectedCounts = Array.from(projectedAppearances.values());
  const appearanceGap = projectedCounts.length > 0
    ? Math.max(...projectedCounts) - Math.min(...projectedCounts)
    : 0;

  const summary = getTournamentFormat(format) === 'singles'
    ? `Built to minimize rematches and keep play counts balanced. Fresh matchups: ${freshOpponentPairs}, repeat matchups: ${repeatOpponentPairs}, appearance gap: ${appearanceGap}.`
    : `Built to favor fresh partners, reduce repeat opponents, and balance court time. Fresh teammate pairs: ${freshTeammatePairs}, repeat teammate pairs: ${repeatTeammatePairs}, repeat opponent pairs: ${repeatOpponentPairs}, appearance gap: ${appearanceGap}.`;

  return {
    freshTeammatePairs,
    repeatTeammatePairs,
    freshOpponentPairs,
    repeatOpponentPairs,
    appearanceGap,
    summary,
  };
}

export function generateRoundMatches(
  players: Player[],
  round: number,
  format?: TournamentFormat | null,
  existingMatches: Match[] = []
): Partial<Match>[] {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const matches: Partial<Match>[] = [];
  const activeHistory = existingMatches.filter((match) => match.status !== 'void');
  const latestRound = activeHistory.length > 0 ? Math.max(...activeHistory.map((match) => match.round)) : 0;
  const latestRoundMatches = activeHistory.filter((match) => match.round === latestRound);

  const pairKey = (a: string, b: string) => [a, b].sort().join('::');
  const matchupKey = (teamA: string[], teamB: string[]) => {
    const left = [...teamA].sort().join('&');
    const right = [...teamB].sort().join('&');
    return [left, right].sort().join('::vs::');
  };

  const teammateCounts = new Map<string, number>();
  const opponentCounts = new Map<string, number>();
  const recentTeammates = new Set<string>();
  const recentOpponents = new Set<string>();
  const appearanceCounts = new Map<string, number>();

  activeHistory.forEach((match) => {
    const teams = [match.team1, match.team2];
    teams.forEach((team) => {
      team.forEach((playerId) => {
        appearanceCounts.set(playerId, (appearanceCounts.get(playerId) || 0) + 1);
      });
      for (let i = 0; i < team.length; i += 1) {
        for (let j = i + 1; j < team.length; j += 1) {
          const key = pairKey(team[i], team[j]);
          teammateCounts.set(key, (teammateCounts.get(key) || 0) + 1);
        }
      }
    });

    match.team1.forEach((team1Player) => {
      match.team2.forEach((team2Player) => {
        const key = pairKey(team1Player, team2Player);
        opponentCounts.set(key, (opponentCounts.get(key) || 0) + 1);
      });
    });
  });

  latestRoundMatches.forEach((match) => {
    for (let i = 0; i < match.team1.length; i += 1) {
      for (let j = i + 1; j < match.team1.length; j += 1) {
        recentTeammates.add(pairKey(match.team1[i], match.team1[j]));
      }
    }
    for (let i = 0; i < match.team2.length; i += 1) {
      for (let j = i + 1; j < match.team2.length; j += 1) {
        recentTeammates.add(pairKey(match.team2[i], match.team2[j]));
      }
    }
    match.team1.forEach((team1Player) => {
      match.team2.forEach((team2Player) => {
        recentOpponents.add(pairKey(team1Player, team2Player));
      });
    });
  });

  const getTeammatePenalty = (a: string, b: string) => {
    const key = pairKey(a, b);
    return (teammateCounts.get(key) || 0) * 1000 + (recentTeammates.has(key) ? 5000 : 0);
  };

  const getOpponentPenalty = (a: string, b: string) => {
    const key = pairKey(a, b);
    return (opponentCounts.get(key) || 0) * 120 + (recentOpponents.has(key) ? 1200 : 0);
  };

  const getAppearancePenalty = (playerIds: string[]) => {
    const counts = playerIds.map((playerId) => appearanceCounts.get(playerId) || 0);
    return Math.max(...counts) - Math.min(...counts);
  };

  if (getTournamentFormat(format) === 'singles') {
    const remaining = shuffled.map((player) => player.id);

    while (remaining.length >= 2) {
      let bestPair: [string, string] | null = null;
      let bestScore = Number.POSITIVE_INFINITY;

      for (let i = 0; i < remaining.length; i += 1) {
        for (let j = i + 1; j < remaining.length; j += 1) {
          const playerA = remaining[i];
          const playerB = remaining[j];
          const score =
            getOpponentPenalty(playerA, playerB) * 10 +
            getAppearancePenalty([playerA, playerB]);

          if (score < bestScore) {
            bestScore = score;
            bestPair = [playerA, playerB];
          }
        }
      }

      if (!bestPair) break;

      matches.push({
        round,
        team1: [bestPair[0]],
        team2: [bestPair[1]],
        score1: 0,
        score2: 0,
        status: 'pending',
      });

      bestPair.forEach((playerId) => {
        appearanceCounts.set(playerId, (appearanceCounts.get(playerId) || 0) + 1);
        const index = remaining.indexOf(playerId);
        if (index >= 0) remaining.splice(index, 1);
      });
    }

    return matches;
  }

  const remaining = shuffled.map((player) => player.id);

  while (remaining.length >= 4) {
    let bestMatch: { team1: string[]; team2: string[] } | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let i = 0; i < remaining.length; i += 1) {
      for (let j = i + 1; j < remaining.length; j += 1) {
        for (let k = j + 1; k < remaining.length; k += 1) {
          for (let l = k + 1; l < remaining.length; l += 1) {
            const ids = [remaining[i], remaining[j], remaining[k], remaining[l]];
            const candidates = [
              { team1: [ids[0], ids[1]], team2: [ids[2], ids[3]] },
              { team1: [ids[0], ids[2]], team2: [ids[1], ids[3]] },
              { team1: [ids[0], ids[3]], team2: [ids[1], ids[2]] },
            ];

            candidates.forEach((candidate) => {
              const score =
                getTeammatePenalty(candidate.team1[0], candidate.team1[1]) +
                getTeammatePenalty(candidate.team2[0], candidate.team2[1]) +
                candidate.team1.reduce((sum, team1Player) => (
                  sum + candidate.team2.reduce((inner, team2Player) => inner + getOpponentPenalty(team1Player, team2Player), 0)
                ), 0) +
                getAppearancePenalty([...candidate.team1, ...candidate.team2]) * 15 +
                (activeHistory.some((match) => matchupKey(match.team1, match.team2) === matchupKey(candidate.team1, candidate.team2)) ? 2500 : 0);

              if (score < bestScore) {
                bestScore = score;
                bestMatch = candidate;
              }
            });
          }
        }
      }
    }

    if (!bestMatch) break;

    matches.push({
      round,
      team1: bestMatch.team1,
      team2: bestMatch.team2,
      score1: 0,
      score2: 0,
      status: 'pending',
    });

    [...bestMatch.team1, ...bestMatch.team2].forEach((playerId) => {
      appearanceCounts.set(playerId, (appearanceCounts.get(playerId) || 0) + 1);
      const index = remaining.indexOf(playerId);
      if (index >= 0) remaining.splice(index, 1);
    });
  }

  return matches;
}

export function summarizeRoundGeneration(
  matches: Partial<Match>[],
  existingMatches: Match[],
  format?: TournamentFormat | null
): RoundGenerationSummary {
  return buildRoundGenerationSummary(matches, existingMatches, format);
}

export function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No O, I, 1, 0
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
