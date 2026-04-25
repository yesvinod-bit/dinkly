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

function timestampToMillis(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;

  if ('toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }

  if ('seconds' in value && typeof value.seconds === 'number') {
    const nanoseconds = 'nanoseconds' in value && typeof value.nanoseconds === 'number'
      ? value.nanoseconds
      : 0;
    return value.seconds * 1000 + Math.floor(nanoseconds / 1_000_000);
  }

  return null;
}

interface PlayerRotationStats {
  appearanceCounts: Map<string, number>;
  benchCounts: Map<string, number>;
  latestBenchStreaks: Map<string, number>;
  lastRoundBenched: Set<string>;
  maxAppearanceCount: number;
}

interface BenchCandidate {
  benchIds: string[];
  penalty: number;
  tieBreaker: number;
}

function buildPlayerRotationStats(players: Player[], activeHistory: Match[]): PlayerRotationStats {
  const playerIds = players.map((player) => player.id);
  const appearanceCounts = new Map<string, number>();
  const benchCounts = new Map<string, number>(playerIds.map((playerId) => [playerId, 0]));
  const latestBenchStreaks = new Map<string, number>(playerIds.map((playerId) => [playerId, 0]));
  const lastRoundBenched = new Set<string>();
  const playerAddedAt = new Map<string, number | null>(
    players.map((player) => [player.id, timestampToMillis(player.addedAt)])
  );

  activeHistory.forEach((match) => {
    [...match.team1, ...match.team2].forEach((playerId) => {
      appearanceCounts.set(playerId, (appearanceCounts.get(playerId) || 0) + 1);
    });
  });

  const rounds = Array.from(activeHistory.reduce((map, match) => {
    const existing = map.get(match.round) || { round: match.round, activePlayerIds: new Set<string>(), timestamp: null as number | null };
    [...match.team1, ...match.team2].forEach((playerId) => existing.activePlayerIds.add(playerId));

    const matchTimestamp = timestampToMillis(match.updatedAt);
    existing.timestamp = existing.timestamp === null
      ? matchTimestamp
      : Math.min(existing.timestamp, matchTimestamp ?? existing.timestamp);

    map.set(match.round, existing);
    return map;
  }, new Map<number, { round: number; activePlayerIds: Set<string>; timestamp: number | null }>()).values()).sort((a, b) => a.round - b.round);

  const isPlayerEligibleForRound = (playerId: string, roundTimestamp: number | null, activePlayerIds: Set<string>) => {
    if (activePlayerIds.has(playerId)) return true;

    const addedAt = playerAddedAt.get(playerId) ?? null;
    if (addedAt === null || roundTimestamp === null) return true;

    return addedAt <= roundTimestamp;
  };

  rounds.forEach((roundEntry) => {
    playerIds.forEach((playerId) => {
      if (!isPlayerEligibleForRound(playerId, roundEntry.timestamp, roundEntry.activePlayerIds)) {
        return;
      }

      if (!roundEntry.activePlayerIds.has(playerId)) {
        benchCounts.set(playerId, (benchCounts.get(playerId) || 0) + 1);
      }
    });
  });

  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const roundEntry = rounds[index];

    playerIds.forEach((playerId) => {
      if (latestBenchStreaks.get(playerId) === -1) return;
      if (!isPlayerEligibleForRound(playerId, roundEntry.timestamp, roundEntry.activePlayerIds)) {
        return;
      }

      if (!roundEntry.activePlayerIds.has(playerId)) {
        if (index === rounds.length - 1) {
          lastRoundBenched.add(playerId);
        }
        latestBenchStreaks.set(playerId, (latestBenchStreaks.get(playerId) || 0) + 1);
        return;
      }

      latestBenchStreaks.set(playerId, -1);
    });
  }

  playerIds.forEach((playerId) => {
    if ((latestBenchStreaks.get(playerId) || 0) < 0) {
      latestBenchStreaks.set(playerId, 0);
    }
  });

  const maxAppearanceCount = playerIds.length > 0
    ? Math.max(...playerIds.map((playerId) => appearanceCounts.get(playerId) || 0))
    : 0;

  return {
    appearanceCounts,
    benchCounts,
    latestBenchStreaks,
    lastRoundBenched,
    maxAppearanceCount,
  };
}

function buildBenchCandidates(
  playerIds: string[],
  benchCount: number,
  rotationStats: PlayerRotationStats,
  shuffleOrder: Map<string, number>
): BenchCandidate[] {
  if (benchCount <= 0) {
    return [{ benchIds: [], penalty: 0, tieBreaker: 0 }];
  }

  const { appearanceCounts, benchCounts, latestBenchStreaks, lastRoundBenched, maxAppearanceCount } = rotationStats;
  const combinations: string[][] = [];
  const current: string[] = [];

  const collectCombinations = (startIndex: number) => {
    if (current.length === benchCount) {
      combinations.push([...current]);
      return;
    }

    for (let index = startIndex; index <= playerIds.length - (benchCount - current.length); index += 1) {
      current.push(playerIds[index]);
      collectCombinations(index + 1);
      current.pop();
    }
  };

  collectCombinations(0);

  return combinations.map((benchIds) => {
    const benchSet = new Set(benchIds);
    const projectedAppearances = playerIds.map((playerId) => (
      (appearanceCounts.get(playerId) || 0) + (benchSet.has(playerId) ? 0 : 1)
    ));
    const projectedAppearanceGap = projectedAppearances.length > 0
      ? Math.max(...projectedAppearances) - Math.min(...projectedAppearances)
      : 0;

    const penalty = benchIds.reduce((sum, playerId) => {
      const appearances = appearanceCounts.get(playerId) || 0;
      const totalBenches = benchCounts.get(playerId) || 0;
      const benchStreak = latestBenchStreaks.get(playerId) || 0;
      const appearancePenalty = Math.max(0, maxAppearanceCount - appearances) * 3500;
      const repeatedBenchPenalty = benchStreak * 180000 + (lastRoundBenched.has(playerId) ? 90000 : 0);
      const historicalBenchPenalty = totalBenches * 4500;
      return sum + appearancePenalty + repeatedBenchPenalty + historicalBenchPenalty;
    }, projectedAppearanceGap * 12000);

    const tieBreaker = benchIds.reduce((sum, playerId) => sum + (shuffleOrder.get(playerId) ?? 0), 0);

    return { benchIds, penalty, tieBreaker };
  }).sort((left, right) => (
    left.penalty - right.penalty || left.tieBreaker - right.tieBreaker
  ));
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
  const activeHistory = existingMatches.filter((match) => match.status !== 'void');
  const latestRound = activeHistory.length > 0 ? Math.max(...activeHistory.map((match) => match.round)) : 0;
  const latestRoundMatches = activeHistory.filter((match) => match.round === latestRound);
  const shuffledPlayerIds = [...players]
    .sort(() => Math.random() - 0.5)
    .map((player) => player.id);
  const shuffleOrder = new Map<string, number>(
    shuffledPlayerIds.map((playerId, index) => [playerId, index])
  );
  const rotationStats = buildPlayerRotationStats(players, activeHistory);

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
  const appearanceCounts = new Map(rotationStats.appearanceCounts);
  const previousMatchups = new Set(activeHistory.map((match) => matchupKey(match.team1, match.team2)));

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

  const getTieBreaker = (playerIds: string[]) => (
    playerIds.reduce((sum, playerId) => sum + (shuffleOrder.get(playerId) ?? 0), 0)
  );

  const buildSinglesRound = (activePlayerIds: string[]) => {
    const roundMatches: Partial<Match>[] = [];
    const localAppearanceCounts = new Map(appearanceCounts);
    const remaining = [...activePlayerIds];
    let totalScore = 0;

    while (remaining.length >= 2) {
      let bestPair: [string, string] | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      let bestTieBreaker = Number.POSITIVE_INFINITY;

      const getLocalAppearancePenalty = (playerIds: string[]) => {
        const counts = playerIds.map((playerId) => localAppearanceCounts.get(playerId) || 0);
        return Math.max(...counts) - Math.min(...counts);
      };

      for (let i = 0; i < remaining.length; i += 1) {
        for (let j = i + 1; j < remaining.length; j += 1) {
          const playerA = remaining[i];
          const playerB = remaining[j];
          const score =
            getOpponentPenalty(playerA, playerB) * 10 +
            getLocalAppearancePenalty([playerA, playerB]);
          const tieBreaker = getTieBreaker([playerA, playerB]);

          if (score < bestScore || (score === bestScore && tieBreaker < bestTieBreaker)) {
            bestScore = score;
            bestPair = [playerA, playerB];
            bestTieBreaker = tieBreaker;
          }
        }
      }

      if (!bestPair) break;

      totalScore += bestScore;
      roundMatches.push({
        round,
        team1: [bestPair[0]],
        team2: [bestPair[1]],
        score1: 0,
        score2: 0,
        status: 'pending',
      });

      bestPair.forEach((playerId) => {
        localAppearanceCounts.set(playerId, (localAppearanceCounts.get(playerId) || 0) + 1);
        const index = remaining.indexOf(playerId);
        if (index >= 0) remaining.splice(index, 1);
      });
    }

    return { matches: roundMatches, score: totalScore };
  };

  const buildDoublesRound = (activePlayerIds: string[]) => {
    const roundMatches: Partial<Match>[] = [];
    const localAppearanceCounts = new Map(appearanceCounts);
    const remaining = [...activePlayerIds];
    let totalScore = 0;

    const getLocalAppearancePenalty = (playerIds: string[]) => {
      const counts = playerIds.map((playerId) => localAppearanceCounts.get(playerId) || 0);
      return Math.max(...counts) - Math.min(...counts);
    };

    while (remaining.length >= 4) {
      let bestMatch: { team1: string[]; team2: string[] } | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      let bestTieBreaker = Number.POSITIVE_INFINITY;

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
                  getLocalAppearancePenalty([...candidate.team1, ...candidate.team2]) * 15 +
                  (previousMatchups.has(matchupKey(candidate.team1, candidate.team2)) ? 2500 : 0);
                const tieBreaker = getTieBreaker([...candidate.team1, ...candidate.team2]);

                if (score < bestScore || (score === bestScore && tieBreaker < bestTieBreaker)) {
                  bestScore = score;
                  bestMatch = candidate;
                  bestTieBreaker = tieBreaker;
                }
              });
            }
          }
        }
      }

      if (!bestMatch) break;

      totalScore += bestScore;
      roundMatches.push({
        round,
        team1: bestMatch.team1,
        team2: bestMatch.team2,
        score1: 0,
        score2: 0,
        status: 'pending',
      });

      [...bestMatch.team1, ...bestMatch.team2].forEach((playerId) => {
        localAppearanceCounts.set(playerId, (localAppearanceCounts.get(playerId) || 0) + 1);
        const index = remaining.indexOf(playerId);
        if (index >= 0) remaining.splice(index, 1);
      });
    }

    return { matches: roundMatches, score: totalScore };
  };

  const playerSlotsPerRound = getTournamentFormat(format) === 'singles' ? 2 : 4;
  const benchCount = shuffledPlayerIds.length % playerSlotsPerRound;
  const benchCandidates = buildBenchCandidates(shuffledPlayerIds, benchCount, rotationStats, shuffleOrder)
    .slice(0, 12);

  let bestPlan: { matches: Partial<Match>[]; score: number; tieBreaker: number } | null = null;

  benchCandidates.forEach((candidate) => {
    const benchSet = new Set(candidate.benchIds);
    const activePlayerIds = shuffledPlayerIds.filter((playerId) => !benchSet.has(playerId));
    const roundPlan = getTournamentFormat(format) === 'singles'
      ? buildSinglesRound(activePlayerIds)
      : buildDoublesRound(activePlayerIds);

    if (roundPlan.matches.length === 0) return;

    const totalScore = candidate.penalty + roundPlan.score;
    if (
      !bestPlan ||
      totalScore < bestPlan.score ||
      (totalScore === bestPlan.score && candidate.tieBreaker < bestPlan.tieBreaker)
    ) {
      bestPlan = {
        matches: roundPlan.matches,
        score: totalScore,
        tieBreaker: candidate.tieBreaker,
      };
    }
  });

  return bestPlan?.matches ?? [];
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
