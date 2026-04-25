import assert from 'node:assert/strict';
import type { Match } from './src/lib/firebase.ts';
import { generateRoundMatches, getMinimumPlayers, getTournamentFormat } from './src/lib/tournamentLogic.ts';

type MockPlayer = {
  id: string;
  name: string;
  points: number;
  gamesPlayed: number;
  wins: number;
  addedAt: unknown;
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

function main() {
  testTournamentFormats();
  testSinglesRoundGeneration();
  testDoublesRoundGeneration();
  testSinglesBenchRotation();
  testDoublesBenchRotation();
  console.log('logic tests passed');
}

main();
