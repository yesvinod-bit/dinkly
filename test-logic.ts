import { generateRoundMatches } from './src/lib/tournamentLogic';

const mockPlayers = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `p${i}`,
  name: `Player ${i}`,
  points: 0,
  gamesPlayed: 0,
  wins: 0,
  addedAt: { seconds: 0, nanoseconds: 0 } as any
}));

function test() {
  console.log("--- Testing generateRoundMatches ---");
  
  [3, 4, 6, 8, 9].forEach(count => {
    const players = mockPlayers(count);
    const matches = generateRoundMatches(players, 1);
    console.log(`Players: ${count}, Matches Generated: ${matches.length}`);
    
    if (count < 4 && matches.length !== 0) {
      console.error(`FAIL: Should generate 0 matches for ${count} players`);
    }
    
    if (count >= 4 && count < 8 && matches.length !== 1) {
       console.error(`FAIL: Should generate 1 match for ${count} players`);
    }

    if (count >= 8 && matches.length !== 2) {
       console.error(`FAIL: Should generate 2 matches for ${count} players`);
    }

    // Check for duplicate players across matches
    const allPlayersInRound = matches.flatMap(m => [...(m.team1 || []), ...(m.team2 || [])]);
    const uniquePlayers = new Set(allPlayersInRound);
    if (uniquePlayers.size !== allPlayersInRound.length) {
      console.error(`FAIL: Duplicate players in round for ${count} players`);
    }
  });

  console.log("--- End Testing ---");
}

test();
