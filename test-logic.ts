import assert from 'node:assert/strict';
import type { Match } from './src/lib/firebase.ts';
import { buildInviteUrl, buildSpectatorUrl, getPublicAppOrigin, getPublicAppUrl } from './src/lib/appUrl.ts';
import { buildProfileAdvice, type ProfileAdviceStats } from './src/lib/profileAdvice.ts';
import {
  buildSeededPlayoffMatches,
  generateRoundMatches,
  getFixedPairingStatus,
  getFixedPairStandings,
  getMinimumPlayers,
  getTournamentFormat,
  getTournamentPairingMode,
  type SeededPlayoffPair,
} from './src/lib/tournamentLogic.ts';

type MockPlayer = {
  id: string;
  name: string;
  points: number;
  gamesPlayed: number;
  wins: number;
  addedAt: unknown;
  fixedPairId?: string;
};

const mockPlayers = (count: number): MockPlayer[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    name: `Player ${index + 1}`,
    points: 0,
    gamesPlayed: 0,
    wins: 0,
    addedAt: { seconds: 0, nanoseconds: 0 },
  }));

function assertUniquePlayersPerRound(matches: ReturnType<typeof generateRoundMatches>) {
  const allPlayers = matches.flatMap((match) => [...(match.team1 ?? []), ...(match.team2 ?? [])]);
  assert.equal(new Set(allPlayers).size, allPlayers.length, 'players should not be duplicated within a round');
}

function getBenchedPlayerIds(players: MockPlayer[], matches: ReturnType<typeof generateRoundMatches>) {
  const activePlayerIds = new Set(matches.flatMap((match) => [...(match.team1 ?? []), ...(match.team2 ?? [])]));
  return players
    .map((player) => player.id)
    .filter((playerId) => !activePlayerIds.has(playerId))
    .sort();
}

function toHistoryMatches(matches: ReturnType<typeof generateRoundMatches>, round: number): Match[] {
  return matches.map((match, index) => ({
    id: `r${round}-m${index}`,
    round,
    team1: match.team1 ?? [],
    team2: match.team2 ?? [],
    score1: match.score1 ?? 0,
    score2: match.score2 ?? 0,
    status: match.status ?? 'pending',
    updatedAt: {
      toMillis: () => round * 1000 + index,
      seconds: round,
      nanoseconds: index,
    } as any,
  }));
}

function testTournamentFormats() {
  assert.equal(getTournamentFormat('singles'), 'singles');
  assert.equal(getTournamentFormat('doubles'), 'doubles');
  assert.equal(getTournamentFormat(undefined), 'doubles');
  assert.equal(getTournamentPairingMode(undefined, 'doubles'), 'random');
  assert.equal(getTournamentPairingMode('fixed', 'doubles'), 'fixed');
  assert.equal(getTournamentPairingMode('fixed', 'singles'), 'random');
  assert.equal(getMinimumPlayers('singles'), 2);
  assert.equal(getMinimumPlayers('doubles'), 4);
}

function testSinglesRoundGeneration() {
  const twoPlayers = generateRoundMatches(mockPlayers(2) as any, 1, 'singles');
  assert.equal(twoPlayers.length, 1, '2 singles players should produce 1 match');
  assert.deepEqual(twoPlayers[0].team1?.length, 1);
  assert.deepEqual(twoPlayers[0].team2?.length, 1);
  assert.equal(twoPlayers[0].status, 'pending');

  const fivePlayers = generateRoundMatches(mockPlayers(5) as any, 2, 'singles');
  assert.equal(fivePlayers.length, 2, '5 singles players should produce 2 matches');
  assertUniquePlayersPerRound(fivePlayers);
}

function testDoublesRoundGeneration() {
  const fourPlayers = generateRoundMatches(mockPlayers(4) as any, 1, 'doubles');
  assert.equal(fourPlayers.length, 1, '4 doubles players should produce 1 match');
  assert.deepEqual(fourPlayers[0].team1?.length, 2);
  assert.deepEqual(fourPlayers[0].team2?.length, 2);

  const ninePlayers = generateRoundMatches(mockPlayers(9) as any, 3, 'doubles');
  assert.equal(ninePlayers.length, 2, '9 doubles players should produce 2 matches');
  assertUniquePlayersPerRound(ninePlayers);
}

function testSinglesBenchRotation() {
  const players = mockPlayers(3) as any as MockPlayer[];
  const benchCounts = new Map<string, number>();
  let history: Match[] = [];
  let previousBenched: string[] = [];

  for (let round = 1; round <= 3; round += 1) {
    const roundMatches = generateRoundMatches(players as any, round, 'singles', history);
    const benchedPlayerIds = getBenchedPlayerIds(players, roundMatches);

    assert.equal(benchedPlayerIds.length, 1, '3 singles players should bench exactly 1 player');
    if (previousBenched.length > 0) {
      assert.notDeepEqual(benchedPlayerIds, previousBenched, 'the same singles player should not be benched in back-to-back rounds');
    }

    benchCounts.set(benchedPlayerIds[0], (benchCounts.get(benchedPlayerIds[0]) || 0) + 1);
    history = [...history, ...toHistoryMatches(roundMatches, round)];
    previousBenched = benchedPlayerIds;
  }

  assert.equal(benchCounts.size, 3, 'all singles players should rotate through the bench over 3 rounds');
}

function testDoublesBenchRotation() {
  const players = mockPlayers(5) as any as MockPlayer[];
  const benchCounts = new Map<string, number>();
  let history: Match[] = [];
  let previousBenched: string[] = [];

  for (let round = 1; round <= 5; round += 1) {
    const roundMatches = generateRoundMatches(players as any, round, 'doubles', history);
    const benchedPlayerIds = getBenchedPlayerIds(players, roundMatches);

    assert.equal(benchedPlayerIds.length, 1, '5 doubles players should bench exactly 1 player');
    if (previousBenched.length > 0) {
      assert.notDeepEqual(benchedPlayerIds, previousBenched, 'the same doubles player should not be benched in back-to-back rounds');
    }

    benchCounts.set(benchedPlayerIds[0], (benchCounts.get(benchedPlayerIds[0]) || 0) + 1);
    history = [...history, ...toHistoryMatches(roundMatches, round)];
    previousBenched = benchedPlayerIds;
  }

  assert.equal(benchCounts.size, 5, 'all doubles players should rotate through the bench over 5 rounds');
}

function testFixedPairValidation() {
  const players = mockPlayers(4) as any as MockPlayer[];
  players[0].fixedPairId = 'pair-a';
  players[1].fixedPairId = 'pair-a';
  players[2].fixedPairId = 'pair-b';

  const incompleteStatus = getFixedPairingStatus(players as any);
  assert.equal(incompleteStatus.isReady, false, 'fixed mode should require every player to be paired');

  players[3].fixedPairId = 'pair-b';
  const readyStatus = getFixedPairingStatus(players as any);
  assert.equal(readyStatus.isReady, true, 'two complete fixed pairs should be ready');
  assert.equal(readyStatus.pairs.length, 2);
}

function testFixedPairRoundGeneration() {
  const players = mockPlayers(6) as any as MockPlayer[];
  players[0].fixedPairId = 'pair-a';
  players[1].fixedPairId = 'pair-a';
  players[2].fixedPairId = 'pair-b';
  players[3].fixedPairId = 'pair-b';
  players[4].fixedPairId = 'pair-c';
  players[5].fixedPairId = 'pair-c';

  const firstRound = generateRoundMatches(players as any, 1, 'doubles', [], 'fixed');
  assert.equal(firstRound.length, 1, '3 fixed pairs should produce one match and bench one pair');
  assertUniquePlayersPerRound(firstRound);
  [firstRound[0].team1, firstRound[0].team2].forEach((team) => {
    assert.ok(team, 'fixed pair team should exist');
    const pairIds = new Set(team?.map((playerId) => players.find((player) => player.id === playerId)?.fixedPairId));
    assert.equal(pairIds.size, 1, 'fixed pair teammates should stay together');
  });

  const history = toHistoryMatches(firstRound, 1);
  const secondRound = generateRoundMatches(players as any, 2, 'doubles', history, 'fixed');
  assert.equal(secondRound.length, 1, 'fixed pair mode should keep generating pair-vs-pair rounds');
  assertUniquePlayersPerRound(secondRound);
}

function testFixedPairStandingsByStage() {
  const players = mockPlayers(4) as any as MockPlayer[];
  players[0].fixedPairId = 'pair-a';
  players[1].fixedPairId = 'pair-a';
  players[2].fixedPairId = 'pair-b';
  players[3].fixedPairId = 'pair-b';

  const matches: Match[] = [
    {
      id: 'prelim-1',
      round: 1,
      team1: ['p0', 'p1'],
      team2: ['p2', 'p3'],
      score1: 11,
      score2: 5,
      status: 'completed',
      updatedAt: { toMillis: () => 1000, seconds: 1, nanoseconds: 0 } as any,
    },
    {
      id: 'playoff-1',
      round: 2,
      stage: 'playoff',
      playoffRound: 1,
      roundLabel: 'Playoff Final',
      seed1: 1,
      seed2: 2,
      team1: ['p0', 'p1'],
      team2: ['p2', 'p3'],
      score1: 4,
      score2: 11,
      status: 'completed',
      updatedAt: { toMillis: () => 2000, seconds: 2, nanoseconds: 0 } as any,
    },
  ];

  const preliminary = getFixedPairStandings(players as any, matches, 'preliminary');
  const playoff = getFixedPairStandings(players as any, matches, 'playoff');

  assert.equal(preliminary.find((standing) => standing.id === 'pair-a')?.wins, 1);
  assert.equal(preliminary.find((standing) => standing.id === 'pair-b')?.wins, 0);
  assert.equal(playoff.find((standing) => standing.id === 'pair-a')?.wins, 0);
  assert.equal(playoff.find((standing) => standing.id === 'pair-b')?.wins, 1);
  assert.equal(playoff.find((standing) => standing.id === 'pair-b')?.gamesPlayed, 1);
}

function testSeededPlayoffMatchGeneration() {
  const seededPairs: SeededPlayoffPair[] = [
    { id: 'pair-a', playerIds: ['p0', 'p1'], label: 'Pair A', seed: 1 },
    { id: 'pair-b', playerIds: ['p2', 'p3'], label: 'Pair B', seed: 2 },
    { id: 'pair-c', playerIds: ['p4', 'p5'], label: 'Pair C', seed: 3 },
    { id: 'pair-d', playerIds: ['p6', 'p7'], label: 'Pair D', seed: 4 },
  ];

  const matches = buildSeededPlayoffMatches(seededPairs, 7, 1);

  assert.equal(matches.length, 2);
  assert.equal(matches[0].stage, 'playoff');
  assert.equal(matches[0].roundLabel, 'Playoff Semifinal');
  assert.equal(matches[0].seed1, 1);
  assert.equal(matches[0].seed2, 4);
  assert.deepEqual(matches[0].team1, ['p0', 'p1']);
  assert.deepEqual(matches[0].team2, ['p6', 'p7']);
  assert.equal(matches[1].seed1, 2);
  assert.equal(matches[1].seed2, 3);
}

function testPublicAppUrls() {
  assert.equal(getPublicAppOrigin('https://dinkly.net'), 'https://dinkly.net');
  assert.equal(
    getPublicAppOrigin('https://ais-dev-dinkly.example.com'),
    'https://ais-pre-dinkly.example.com',
  );
  assert.equal(
    getPublicAppUrl('https://ais-dev-dinkly.example.com/?view=abc'),
    'https://ais-pre-dinkly.example.com/?view=abc',
  );
  assert.equal(buildInviteUrl('https://dinkly.net', 'JOIN123'), 'https://dinkly.net/?invite=JOIN123');
  assert.equal(buildSpectatorUrl('https://dinkly.net', 'tour-1'), 'https://dinkly.net/?view=tour-1');
}

function makeProfileAdviceStats(overrides: Partial<ProfileAdviceStats>): ProfileAdviceStats {
  return {
    displayName: 'Test Player',
    totalGames: 10,
    totalWins: 5,
    totalPoints: 100,
    winRate: 50,
    formatBreakdown: {
      doubles: { tournaments: 1, games: 10, wins: 5, points: 100, winRate: 50 },
      singles: { tournaments: 0, games: 0, wins: 0, points: 0, winRate: 0 },
    },
    ...overrides,
  };
}

function testProfileAdvice() {
  const highScoreAdvice = buildProfileAdvice(makeProfileAdviceStats({
    totalWins: 8,
    totalPoints: 150,
    winRate: 80,
    formatBreakdown: {
      doubles: { tournaments: 2, games: 10, wins: 8, points: 150, winRate: 80 },
      singles: { tournaments: 0, games: 0, wins: 0, points: 0, winRate: 0 },
    },
  }), 'doubles', 1);
  assert.equal(highScoreAdvice.tone, 'humbling');

  const lowScoreAdvice = buildProfileAdvice(makeProfileAdviceStats({
    totalWins: 1,
    totalPoints: 35,
    winRate: 10,
    formatBreakdown: {
      doubles: { tournaments: 1, games: 10, wins: 1, points: 35, winRate: 10 },
      singles: { tournaments: 0, games: 0, wins: 0, points: 0, winRate: 0 },
    },
  }), 'doubles', 1);
  assert.equal(lowScoreAdvice.tone, 'motivating');

  const refreshedAdvice = buildProfileAdvice(makeProfileAdviceStats({}), 'doubles', 2);
  assert.notEqual(
    buildProfileAdvice(makeProfileAdviceStats({}), 'doubles', 3).message,
    refreshedAdvice.message,
    'changing the nonce should rotate the advice pool'
  );

  const sampledMessages = new Set(
    Array.from({ length: 40 }, (_, index) => (
      buildProfileAdvice(makeProfileAdviceStats({}), 'doubles', index).message
    ))
  );
  assert.ok(sampledMessages.size >= 30, 'profile advice should have a broad dynamic message range');
}

function main() {
  testTournamentFormats();
  testSinglesRoundGeneration();
  testDoublesRoundGeneration();
  testSinglesBenchRotation();
  testDoublesBenchRotation();
  testFixedPairValidation();
  testFixedPairRoundGeneration();
  testFixedPairStandingsByStage();
  testSeededPlayoffMatchGeneration();
  testPublicAppUrls();
  testProfileAdvice();
  console.log('logic tests passed');
}

main();
