import type { Match, Player, Session, SessionAbsence, TournamentFormat, TournamentPairingMode, TournamentStage } from './firebase.ts';

export const DEFAULT_TOURNAMENT_FORMAT: TournamentFormat = 'doubles';
export const DEFAULT_TOURNAMENT_PAIRING_MODE: TournamentPairingMode = 'random';

export function getTournamentFormat(format?: TournamentFormat | null): TournamentFormat {
  return format === 'singles' ? 'singles' : DEFAULT_TOURNAMENT_FORMAT;
}

export function getTournamentPairingMode(
  pairingMode?: TournamentPairingMode | null,
  format?: TournamentFormat | null
): TournamentPairingMode {
  return getTournamentFormat(format) === 'doubles' && pairingMode === 'fixed'
    ? 'fixed'
    : DEFAULT_TOURNAMENT_PAIRING_MODE;
}

export function getTournamentFormatTag(format?: TournamentFormat | null): { label: string; detail: string } {
  return getTournamentFormat(format) === 'singles'
    ? { label: 'Singles', detail: '1v1' }
    : { label: 'Doubles', detail: '2v2' };
}

export function getMinimumPlayers(format?: TournamentFormat | null): number {
  return getTournamentFormat(format) === 'singles' ? 2 : 4;
}

export interface FixedPair {
  id: string;
  playerIds: string[];
  label: string;
}

export interface FixedPairStanding extends FixedPair {
  seed: number;
  points: number;
  gamesPlayed: number;
  wins: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  averageDiff: number;
  headToHead: Map<string, number>;
}

export interface SeededPlayoffPair extends FixedPair {
  seed: number;
}

export interface FixedPairingStatus {
  pairs: FixedPair[];
  unpairedPlayers: Player[];
  invalidPairs: FixedPair[];
  isReady: boolean;
  issue: string | null;
}

export function getFixedPairingStatus(players: Player[]): FixedPairingStatus {
  const playersByPairId = new Map<string, Player[]>();
  const unpairedPlayers: Player[] = [];

  players.forEach((player) => {
    const pairId = player.fixedPairId?.trim();
    if (!pairId) {
      unpairedPlayers.push(player);
      return;
    }

    const pairPlayers = playersByPairId.get(pairId) || [];
    pairPlayers.push(player);
    playersByPairId.set(pairId, pairPlayers);
  });

  const allPairs = Array.from(playersByPairId.entries()).map(([id, pairPlayers]) => ({
    id,
    playerIds: pairPlayers.map((player) => player.id),
    label: pairPlayers.map((player) => player.name).join(' & '),
  }));
  const pairs = allPairs.filter((pair) => pair.playerIds.length === 2);
  const invalidPairs = allPairs.filter((pair) => pair.playerIds.length !== 2);

  let issue: string | null = null;
  if (players.length < getMinimumPlayers('doubles')) {
    issue = 'Fixed pair mode needs at least 4 players.';
  } else if (players.length % 2 !== 0) {
    issue = 'Fixed pair mode needs an even number of players.';
  } else if (unpairedPlayers.length > 0) {
    issue = `${unpairedPlayers.length} player${unpairedPlayers.length === 1 ? '' : 's'} still need a fixed partner.`;
  } else if (invalidPairs.length > 0) {
    issue = 'Every fixed pair must have exactly 2 players.';
  }

  return {
    pairs,
    unpairedPlayers,
    invalidPairs,
    isReady: issue === null,
    issue,
  };
}

export function getFixedPairs(players: Player[]): FixedPair[] {
  return Array.from(players.reduce((map, player) => {
    if (!player.fixedPairId) return map;
    const pairPlayers = map.get(player.fixedPairId) || [];
    pairPlayers.push(player);
    map.set(player.fixedPairId, pairPlayers);
    return map;
  }, new Map<string, Player[]>()).entries())
    .filter(([, pairPlayers]) => pairPlayers.length === 2)
    .map(([pairId, pairPlayers]) => ({
      id: pairId,
      playerIds: pairPlayers.map((player) => player.id),
      label: pairPlayers.map((player) => player.name).join(' & '),
    }));
}

function getMatchStage(match: Match): TournamentStage {
  return match.stage === 'playoff' ? 'playoff' : 'preliminary';
}

export function getFixedPairStandings(
  players: Player[],
  matches: Match[],
  stage: TournamentStage = 'preliminary'
): FixedPairStanding[] {
  const fixedPairs = getFixedPairs(players);
  const fixedPairByPlayerId = new Map<string, string>();
  fixedPairs.forEach((pair) => {
    pair.playerIds.forEach((playerId) => {
      fixedPairByPlayerId.set(playerId, pair.id);
    });
  });

  const rankedRows: FixedPairStanding[] = fixedPairs.map((pair) => ({
    ...pair,
    seed: 0,
    points: 0,
    gamesPlayed: 0,
    wins: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    pointDiff: 0,
    averageDiff: 0,
    headToHead: new Map<string, number>(),
  }));
  const standingMap = new Map(rankedRows.map((standing) => [standing.id, standing]));

  const getPairIdsForTeam = (team: string[]) => {
    const pairIds = Array.from(new Set(
      team
        .map((playerId) => fixedPairByPlayerId.get(playerId))
        .filter((pairId): pairId is string => Boolean(pairId))
    ));
    return pairIds.length === 1 ? pairIds : [];
  };

  matches
    .filter((match) => match.status === 'completed' && getMatchStage(match) === stage)
    .forEach((match) => {
      const team1Won = match.score1 > match.score2;
      const team1StandingIds = getPairIdsForTeam(match.team1);
      const team2StandingIds = getPairIdsForTeam(match.team2);

      team1StandingIds.forEach((standingId) => {
        const standing = standingMap.get(standingId);
        if (!standing) return;
        standing.gamesPlayed += 1;
        if (team1Won) standing.wins += 1;
        standing.pointsFor += match.score1;
        standing.pointsAgainst += match.score2;
      });

      team2StandingIds.forEach((standingId) => {
        const standing = standingMap.get(standingId);
        if (!standing) return;
        standing.gamesPlayed += 1;
        if (!team1Won) standing.wins += 1;
        standing.pointsFor += match.score2;
        standing.pointsAgainst += match.score1;
      });

      team1StandingIds.forEach((team1StandingId) => {
        team2StandingIds.forEach((team2StandingId) => {
          const team1Standing = standingMap.get(team1StandingId);
          const team2Standing = standingMap.get(team2StandingId);
          if (!team1Standing || !team2Standing) return;

          const margin = match.score1 - match.score2;
          team1Standing.headToHead.set(
            team2StandingId,
            (team1Standing.headToHead.get(team2StandingId) || 0) + margin
          );
          team2Standing.headToHead.set(
            team1StandingId,
            (team2Standing.headToHead.get(team1StandingId) || 0) - margin
          );
        });
      });
    });

  rankedRows.forEach((standing) => {
    standing.pointDiff = standing.pointsFor - standing.pointsAgainst;
    standing.points = standing.pointDiff;
    standing.averageDiff = standing.gamesPlayed > 0 ? standing.pointDiff / standing.gamesPlayed : 0;
  });

  return [...rankedRows].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;

    const headToHeadMargin = b.headToHead.get(a.id) || 0;
    if (headToHeadMargin !== 0) return headToHeadMargin;

    if (b.averageDiff !== a.averageDiff) return b.averageDiff - a.averageDiff;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;

    return a.label.localeCompare(b.label);
  }).map((standing, index) => ({
    ...standing,
    seed: index + 1,
  }));
}

export function getPlayoffRoundLabel(pairCount: number): string {
  if (pairCount === 2) return 'Playoff Final';
  if (pairCount === 4) return 'Playoff Semifinal';
  if (pairCount === 8) return 'Playoff Quarterfinal';
  return `Playoff Round of ${pairCount}`;
}

export function buildSeededPlayoffMatches(
  seededPairs: SeededPlayoffPair[],
  round: number,
  playoffRound: number
): Partial<Match>[] {
  const roundLabel = getPlayoffRoundLabel(seededPairs.length);
  const sortedPairs = [...seededPairs].sort((left, right) => left.seed - right.seed);
  const matches: Partial<Match>[] = [];

  for (let index = 0; index < sortedPairs.length / 2; index += 1) {
    const highSeed = sortedPairs[index];
    const lowSeed = sortedPairs[sortedPairs.length - 1 - index];

    matches.push({
      round,
      stage: 'playoff',
      playoffRound,
      roundLabel,
      seed1: highSeed.seed,
      seed2: lowSeed.seed,
      team1: highSeed.playerIds,
      team2: lowSeed.playerIds,
      score1: 0,
      score2: 0,
      status: 'pending',
    });
  }

  return matches;
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

function generateFixedPairRoundMatches(
  players: Player[],
  round: number,
  existingMatches: Match[]
): Partial<Match>[] {
  const fixedPairingStatus = getFixedPairingStatus(players);
  if (!fixedPairingStatus.isReady) {
    return [];
  }

  const fixedPairs = fixedPairingStatus.pairs;
  const fixedPairIds = fixedPairs.map((pair) => pair.id);
  const fixedPairById = new Map(fixedPairs.map((pair) => [pair.id, pair]));
  const playerToPairId = new Map<string, string>();

  fixedPairs.forEach((pair) => {
    pair.playerIds.forEach((playerId) => {
      playerToPairId.set(playerId, pair.id);
    });
  });

  const getTeamFixedPairId = (team: string[]) => {
    const teamPairIds = Array.from(new Set(
      team
        .map((playerId) => playerToPairId.get(playerId))
        .filter((pairId): pairId is string => Boolean(pairId))
    ));
    return teamPairIds.length === 1 ? teamPairIds[0] : null;
  };

  const activeHistory = existingMatches.filter((match) => match.status !== 'void');
  const latestRound = activeHistory.length > 0 ? Math.max(...activeHistory.map((match) => match.round)) : 0;
  const fixedPairAppearanceCounts = new Map<string, number>(fixedPairIds.map((pairId) => [pairId, 0]));
  const fixedPairBenchCounts = new Map<string, number>(fixedPairIds.map((pairId) => [pairId, 0]));
  const latestBenchStreaks = new Map<string, number>(fixedPairIds.map((pairId) => [pairId, 0]));
  const opponentPairCounts = new Map<string, number>();
  const recentOpponentPairs = new Set<string>();
  const lastRoundBenched = new Set<string>();

  const rounds = Array.from(activeHistory.reduce((map, match) => {
    const existing = map.get(match.round) || { round: match.round, activePairIds: new Set<string>() };
    [match.team1, match.team2].forEach((team) => {
      const pairId = getTeamFixedPairId(team);
      if (pairId) {
        existing.activePairIds.add(pairId);
      }
    });
    map.set(match.round, existing);
    return map;
  }, new Map<number, { round: number; activePairIds: Set<string> }>()).values()).sort((a, b) => a.round - b.round);

  activeHistory.forEach((match) => {
    const team1PairId = getTeamFixedPairId(match.team1);
    const team2PairId = getTeamFixedPairId(match.team2);

    if (team1PairId) {
      fixedPairAppearanceCounts.set(team1PairId, (fixedPairAppearanceCounts.get(team1PairId) || 0) + 1);
    }
    if (team2PairId) {
      fixedPairAppearanceCounts.set(team2PairId, (fixedPairAppearanceCounts.get(team2PairId) || 0) + 1);
    }
    if (team1PairId && team2PairId) {
      const key = pairKey(team1PairId, team2PairId);
      opponentPairCounts.set(key, (opponentPairCounts.get(key) || 0) + 1);
      if (match.round === latestRound) {
        recentOpponentPairs.add(key);
      }
    }
  });

  rounds.forEach((roundEntry) => {
    fixedPairIds.forEach((pairId) => {
      if (!roundEntry.activePairIds.has(pairId)) {
        fixedPairBenchCounts.set(pairId, (fixedPairBenchCounts.get(pairId) || 0) + 1);
      }
    });
  });

  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const roundEntry = rounds[index];
    fixedPairIds.forEach((pairId) => {
      if (latestBenchStreaks.get(pairId) === -1) return;

      if (!roundEntry.activePairIds.has(pairId)) {
        if (index === rounds.length - 1) {
          lastRoundBenched.add(pairId);
        }
        latestBenchStreaks.set(pairId, (latestBenchStreaks.get(pairId) || 0) + 1);
        return;
      }

      latestBenchStreaks.set(pairId, -1);
    });
  }

  fixedPairIds.forEach((pairId) => {
    if ((latestBenchStreaks.get(pairId) || 0) < 0) {
      latestBenchStreaks.set(pairId, 0);
    }
  });

  const shuffledFixedPairIds = [...fixedPairIds].sort(() => Math.random() - 0.5);
  const shuffleOrder = new Map<string, number>(
    shuffledFixedPairIds.map((pairId, index) => [pairId, index])
  );
  const benchCount = fixedPairIds.length % 2;
  const benchIds = new Set<string>();

  if (benchCount > 0) {
    const benchPairId = [...fixedPairIds].sort((left, right) => {
      const leftScore =
        (fixedPairBenchCounts.get(left) || 0) * 9000 +
        (latestBenchStreaks.get(left) || 0) * 180000 +
        (lastRoundBenched.has(left) ? 90000 : 0) -
        (fixedPairAppearanceCounts.get(left) || 0) * 4500 +
        (shuffleOrder.get(left) || 0);
      const rightScore =
        (fixedPairBenchCounts.get(right) || 0) * 9000 +
        (latestBenchStreaks.get(right) || 0) * 180000 +
        (lastRoundBenched.has(right) ? 90000 : 0) -
        (fixedPairAppearanceCounts.get(right) || 0) * 4500 +
        (shuffleOrder.get(right) || 0);
      return leftScore - rightScore;
    })[0];

    if (benchPairId) {
      benchIds.add(benchPairId);
    }
  }

  const remainingPairIds = shuffledFixedPairIds.filter((pairId) => !benchIds.has(pairId));
  const roundMatches: Partial<Match>[] = [];

  while (remainingPairIds.length >= 2) {
    let bestMatch: [string, string] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestTieBreaker = Number.POSITIVE_INFINITY;

    for (let i = 0; i < remainingPairIds.length; i += 1) {
      for (let j = i + 1; j < remainingPairIds.length; j += 1) {
        const pairA = remainingPairIds[i];
        const pairB = remainingPairIds[j];
        const key = pairKey(pairA, pairB);
        const appearanceGap = Math.abs(
          (fixedPairAppearanceCounts.get(pairA) || 0) -
          (fixedPairAppearanceCounts.get(pairB) || 0)
        );
        const score =
          (opponentPairCounts.get(key) || 0) * 3500 +
          (recentOpponentPairs.has(key) ? 10000 : 0) +
          appearanceGap * 200;
        const tieBreaker = (shuffleOrder.get(pairA) || 0) + (shuffleOrder.get(pairB) || 0);

        if (score < bestScore || (score === bestScore && tieBreaker < bestTieBreaker)) {
          bestMatch = [pairA, pairB];
          bestScore = score;
          bestTieBreaker = tieBreaker;
        }
      }
    }

    if (!bestMatch) break;

    const team1 = fixedPairById.get(bestMatch[0])?.playerIds;
    const team2 = fixedPairById.get(bestMatch[1])?.playerIds;
    if (!team1 || !team2) break;

    roundMatches.push({
      round,
      team1,
      team2,
      score1: 0,
      score2: 0,
      status: 'pending',
    });

    bestMatch.forEach((pairId) => {
      fixedPairAppearanceCounts.set(pairId, (fixedPairAppearanceCounts.get(pairId) || 0) + 1);
      const index = remainingPairIds.indexOf(pairId);
      if (index >= 0) {
        remainingPairIds.splice(index, 1);
      }
    });
  }

  return roundMatches;
}

export function generateRoundMatches(
  players: Player[],
  round: number,
  format?: TournamentFormat | null,
  existingMatches: Match[] = [],
  pairingMode?: TournamentPairingMode | null
): Partial<Match>[] {
  if (getTournamentPairingMode(pairingMode, format) === 'fixed') {
    return generateFixedPairRoundMatches(players, round, existingMatches);
  }

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

export function filterMatchesBySession(matches: Match[], session: Session): Match[] {
  return matches.filter((m) =>
    m.round >= session.startRound &&
    (session.endRound === undefined || m.round <= session.endRound)
  );
}

export function getSittingOutPlayerIds(players: Player[], absences: Record<string, SessionAbsence>): string[] {
  const absentNoSubIds = players
    .filter((p) => p.id in absences && absences[p.id].subName === null)
    .map((p) => p.id);

  const sittingOutPairIds = new Set<string>(
    players
      .filter((p) => absentNoSubIds.includes(p.id) && p.fixedPairId)
      .map((p) => p.fixedPairId as string)
  );

  return players
    .filter((p) => absentNoSubIds.includes(p.id) || (p.fixedPairId && sittingOutPairIds.has(p.fixedPairId)))
    .map((p) => p.id);
}

export function getSessionForRound(round: number, sessions: Session[]): Session | undefined {
  return sessions.find((s) =>
    round >= s.startRound && (s.endRound === undefined || round <= s.endRound)
  );
}

export function buildSessionName(sessionNumber: number): string {
  const date = new Date();
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} — Session ${sessionNumber}`;
}

export function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No O, I, 1, 0
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
