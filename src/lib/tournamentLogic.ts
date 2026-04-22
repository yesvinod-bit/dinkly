import { Player, Match } from './firebase';

export function generateRoundMatches(players: Player[], round: number): Partial<Match>[] {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const matches: Partial<Match>[] = [];
  
  // Need at least 4 players for a doubles match
  for (let i = 0; i + 3 < shuffled.length; i += 4) {
    matches.push({
      round,
      team1: [shuffled[i].id, shuffled[i + 1].id],
      team2: [shuffled[i + 2].id, shuffled[i + 3].id],
      score1: 0,
      score2: 0,
      status: 'pending',
    });
  }
  
  return matches;
}

export function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No O, I, 1, 0
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
