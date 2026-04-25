import assert from 'node:assert/strict';
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

function main() {
  testTournamentFormats();
  testSinglesRoundGeneration();
  testDoublesRoundGeneration();
  console.log('logic tests passed');
}

main();
