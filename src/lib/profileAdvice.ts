import type { TournamentFormat } from './firebase.ts';
import { getTournamentFormatTag } from './tournamentLogic.ts';

export interface ProfileAdviceStats {
  displayName: string;
  totalGames: number;
  totalWins: number;
  totalPoints: number;
  winRate: number;
  formatBreakdown: Record<TournamentFormat, {
    tournaments: number;
    games: number;
    wins: number;
    points: number;
    winRate: number;
  }>;
}

export interface ProfileAdvice {
  tone: 'new' | 'motivating' | 'steady' | 'humbling';
  title: string;
  message: string;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function pick<T>(items: T[], seed: number, salt: string): T {
  return items[hashString(`${seed}:${salt}`) % items.length];
}

function formatPlayerName(name: string): string {
  const firstName = name.trim().split(/\s+/)[0];
  return firstName || 'Champ';
}

interface AdviceContext {
  playerName: string;
  formatName: string;
  games: number;
  wins: number;
  points: number;
  winRate: number;
  pointsPerGame: number;
}

type AdvicePart = string | ((context: AdviceContext) => string);

interface AdviceRecipe {
  titles: string[];
  openers: AdvicePart[];
  statJabs: AdvicePart[];
  closers: AdvicePart[];
  tags: AdvicePart[];
}

function renderPart(part: AdvicePart, context: AdviceContext): string {
  return typeof part === 'function' ? part(context) : part;
}

function buildDynamicMessage(recipe: AdviceRecipe, context: AdviceContext, seed: number): ProfileAdvice {
  const opener = renderPart(pick(recipe.openers, seed, 'opener'), context);
  const statJab = renderPart(pick(recipe.statJabs, seed, 'stat-jab'), context);
  const closer = renderPart(pick(recipe.closers, seed, 'closer'), context);
  const tag = renderPart(pick(recipe.tags, seed, 'tag'), context);

  return {
    tone: 'steady',
    title: pick(recipe.titles, seed, 'title'),
    message: `${opener} ${statJab} ${closer} ${tag}`,
  };
}

const newPlayerRecipe: AdviceRecipe = {
  titles: [
    'Stat Ghost',
    'Mystery Player',
    'Unroasted For Now',
    'Clean Slate Chaos',
    'Evidence Pending',
    'Court Enigma',
    'No Receipts Yet',
    'Suspiciously Untested',
  ],
  openers: [
    ({ playerName, formatName }) => `${playerName}, your ${formatName} stats are currently invisible.`,
    ({ formatName }) => `No verified ${formatName} games yet.`,
    'The scoreboard has nothing useful on you yet.',
    ({ playerName }) => `${playerName}, your profile is giving "trust me, I am good" energy.`,
    'Your stat line is so clean it looks like it has never met reality.',
    'There is no data here, which is either mysterious or extremely convenient.',
    ({ formatName }) => `Your ${formatName} resume is currently a blank clipboard.`,
    'Right now the numbers cannot roast you, which feels legally suspicious.',
    'Your stats are still hiding behind warmups.',
    'The profile is open, but the receipts have not arrived.',
  ],
  statJabs: [
    'Bold strategy: impossible to judge, suspiciously convenient.',
    'Enjoy this brief era before evidence starts happening.',
    'You are undefeated in theory, which is the easiest place to be undefeated.',
    'The court has not filed its report yet.',
    'Zero games means zero losses, and also zero proof. Very sneaky.',
    'This is peak preseason confidence with no paperwork.',
    'The spreadsheet is waiting politely, which will not last.',
    'Your reputation is currently vibes wearing court shoes.',
    'Nobody can call you overrated until you provide ratings.',
    'You have achieved perfect statistical silence.',
  ],
  closers: [
    'Go claim a player and make the numbers sweat.',
    'Play one real game and give this profile something to gossip about.',
    'The first verified match will ruin the mystery in a productive way.',
    'Step onto the court and let the data develop an opinion.',
    'Start small: one game, one score, one tiny public record.',
    'The app is ready whenever your confidence wants witnesses.',
    'A blank profile is peaceful, but peaceful is not very funny.',
    'Go collect some stats before your legend becomes fan fiction.',
  ],
  tags: [
    'Respectfully.',
    'For science.',
    'With love and mild concern.',
    'No pressure, except scoreboard pressure.',
    'The court is waiting.',
    'Bring snacks and accountability.',
    'Warmups do not count, sadly.',
    'Proceed with suspicious confidence.',
  ],
};

const humblingRecipe: AdviceRecipe = {
  titles: [
    'Ego Check',
    'Stay Grounded',
    'Main Character Audit',
    'Humble Pie Timeout',
    'Confidence Inspection',
    'Standings Detox',
    'Crown Is Crooked',
    'Relax, Superstar',
    'Receipt Control',
    'Victory Lap Violation',
  ],
  openers: [
    ({ playerName, winRate, formatName }) => `${playerName}, a ${winRate}% ${formatName} win rate is loud.`,
    ({ playerName }) => `${playerName}, yes, the numbers are flirting with you.`,
    ({ wins }) => `${wins} wins means you are dangerous.`,
    ({ points }) => `${points} points is impressive.`,
    ({ pointsPerGame }) => `Averaging ${pointsPerGame} points a game is spicy.`,
    'Your profile is starting to look smug.',
    'The stats are good enough to be annoying.',
    'You are one hot streak away from becoming insufferable.',
    'The leaderboard has been very generous to your ego.',
    'Your paddle is building a suspicious amount of confidence.',
    ({ formatName }) => `Your ${formatName} record is doing too much in the group chat.`,
    'The win column is getting comfortable. Too comfortable.',
  ],
  statJabs: [
    'Congrats, now stop looking at the standings like they owe you rent.',
    'Your paddle still has to do the work; it is not a magic wand.',
    'Everyone is one lucky net cord away from calling you overrated.',
    'Please remember this is pickleball, not a documentary about your greatness.',
    'You can be proud without walking like the bracket personally apologized.',
    'The score sheet respects you, but it does not love you.',
    'Winning is nice; narrating it to yourself is where we start worrying.',
    'The other players noticed. They are either impressed or plotting.',
    'You are not unbeatable, just currently inconvenient.',
    'A hot hand is great until it starts giving speeches.',
    'Your stats say "threat"; your celebration should not say "tax audit."',
    'The court does not need a victory parade after every dink.',
  ],
  closers: [
    'Stay humble before the next opponent turns into a problem.',
    'Hydrate, reset, and pretend you have been here before.',
    'Keep winning quietly; it scares people more.',
    'Let the scoreboard talk so you can stop auditioning for it.',
    'Play the next point like your reputation is on probation.',
    'Enjoy it, but keep both feet inside reality.',
    'Great players adjust. Loud players get screenshotted.',
    'Keep the edge, lose the strut.',
    'Act normal for at least three rallies.',
    'Your next loss is already stretching. Do not motivate it.',
  ],
  tags: [
    'Tiny crown, big responsibility.',
    'Respectfully, calm down.',
    'Elite-ish behavior detected.',
    'The audit continues.',
    'Still proud of you, unfortunately.',
    'This compliment has supervision.',
    'Borderline impressive, borderline annoying.',
    'Do not make me side with your opponents.',
  ],
};

const motivatingRecipe: AdviceRecipe = {
  titles: [
    'Comeback Loading',
    'Keep Swinging',
    'Beautiful Disaster',
    'Underdog Accounting',
    'Growth Era',
    'Tiny Flame Detected',
    'Respect The Struggle',
    'Chaos With Potential',
    'Not Dead Yet',
    'Spreadsheet Redemption',
  ],
  openers: [
    ({ playerName, winRate, formatName }) => `${playerName}, a ${winRate}% ${formatName} win rate is not a crisis.`,
    ({ points }) => `${points} points means the ball has met your paddle at least a few times.`,
    ({ wins, games }) => `${wins} wins in ${games} games is humble material.`,
    'The stats are being rude today.',
    'Your record is not pretty, but neither is most improvement.',
    'The scoreboard is acting superior, which is very unnecessary.',
    'Your profile says "work in progress" with excellent comic timing.',
    'The numbers are not bullying you; they are aggressively coaching.',
    'This is not failure, it is character development with side-out scoring.',
    ({ pointsPerGame }) => `${pointsPerGame} points per game is a starting point, not a personality flaw.`,
    'Your win column is shy, but it can be trained.',
    'The comeback has not started yet, which is rude but fixable.',
  ],
  statJabs: [
    'It is a very dramatic origin story with court shoes.',
    'Build from there, legend-in-progress.',
    'Keep playing until the spreadsheet has to apologize.',
    'Nobody suspects the comeback until it starts being annoying.',
    'You are basically farming motivation at this point.',
    'Every missed shot is free footage for the training montage.',
    'The losses are temporary; the jokes are unfortunately immediate.',
    'You are one good run away from becoming a problem with better posture.',
    'This record has room to grow, which is the polite way to say it has a garage.',
    'The bar is low enough to clear dramatically. Use that.',
    'You have nowhere to go but up, unless you serve into the wrong court again.',
    'The stats look grumpy, but they still showed up for you.',
  ],
  closers: [
    'Keep showing up and make the numbers regret their tone.',
    'Win the next point, then another, then act surprised.',
    'Small gains count, even when the scoreboard is being a jerk.',
    'The next version of you is going to be irritating in a good way.',
    'Take the roast, keep the paddle moving.',
    'The comeback department is open for business.',
    'Start with cleaner serves and fewer emotional decisions.',
    'Your future stats are already embarrassed by this phase.',
    'One better rally at a time. Very annoying, very effective.',
    'Go collect a win before this app gets even more sarcastic.',
  ],
  tags: [
    'Lovingly rude.',
    'No quitting, obviously.',
    'Progress has entered the chat.',
    'Still rooting for you.',
    'The court believes in receipts.',
    'Motivation, but with elbows.',
    'Painfully fixable.',
    'Bring water and denial.',
  ],
};

const steadyRecipe: AdviceRecipe = {
  titles: [
    'Respectable Menace',
    'Middle Court Energy',
    'Mildly Dangerous',
    'Solid But Watched',
    'Competent Trouble',
    'Useful In Public',
    'Balanced Threat',
    'Decent Mischief',
    'Quietly Cookin',
    'Almost Annoying',
  ],
  openers: [
    ({ playerName, winRate, formatName }) => `${playerName}, ${winRate}% in ${formatName} is solid.`,
    ({ wins, points }) => `${wins} wins and ${points} points says you are useful in public.`,
    'Your stats are balanced enough to look intentional.',
    ({ pointsPerGame }) => `${pointsPerGame} points a game is respectable.`,
    'You are hovering in the dangerous middle.',
    'The profile says "capable" with a tiny smirk.',
    'Your numbers are not scary, but they are not harmless either.',
    'This is the kind of stat line that makes opponents check twice.',
    'You are not dominating, but you are absolutely in the conversation.',
    'The court has you filed under "do not ignore."',
    ({ formatName }) => `Your ${formatName} game has enough receipts to be taken seriously.`,
    'You have achieved the rare status of mildly stressful opponent.',
  ],
  statJabs: [
    'Not terrifying, not furniture. Keep pushing.',
    'Add a little consistency and people will start dodging you.',
    'Suspicious, but promising.',
    'Add two more points a game and you can start acting unbearable, briefly.',
    'The foundation is there; the drama budget needs work.',
    'You are one adjustment away from ruining someone else\'s afternoon.',
    'This is not a flex yet, but it is flex-adjacent.',
    'The stats are whispering "potential" and coughing politely.',
    'You have enough game to be blamed when things go wrong.',
    'Respectable is good. Feared is better. Annoying is achievable.',
    'Your paddle has moments. Ask it for a full shift.',
    'You are close enough that excuses are getting harder to sell.',
  ],
  closers: [
    'Tighten the loose points and make the room uncomfortable.',
    'Keep stacking decent games until they become inconvenient evidence.',
    'A little more patience and you are suddenly a bracket problem.',
    'Do the boring things well. It is rude how often that works.',
    'Keep the confidence, upgrade the decisions.',
    'You are allowed to be proud, just not loud yet.',
    'The next leap is probably consistency, which is boring and correct.',
    'Stay sharp; average days are where reputations leak.',
    'Make one cleaner choice per rally and watch people get quiet.',
    'Your ceiling is higher than your excuses. Tragic for the excuses.',
  ],
  tags: [
    'Respectfully spicy.',
    'Progress with side-eye.',
    'Almost scary.',
    'The committee is interested.',
    'Keep cooking, lightly.',
    'No parade yet.',
    'Solid chaos.',
    'Useful, unfortunately.',
  ],
};

export function buildProfileAdvice(
  profile: ProfileAdviceStats,
  selectedFormat: TournamentFormat,
  nonce = 0
): ProfileAdvice {
  const formatStats = profile.formatBreakdown[selectedFormat];
  const formatName = getTournamentFormatTag(selectedFormat).label.toLowerCase();
  const games = formatStats.games || profile.totalGames;
  const wins = formatStats.games > 0 ? formatStats.wins : profile.totalWins;
  const points = formatStats.games > 0 ? formatStats.points : profile.totalPoints;
  const winRate = formatStats.games > 0 ? formatStats.winRate : profile.winRate;
  const pointsPerGame = games > 0 ? Math.round(points / games) : 0;
  const playerName = formatPlayerName(profile.displayName);
  const seed = hashString(`${profile.displayName}:${selectedFormat}:${games}:${wins}:${points}:${winRate}:${nonce}`);
  const context: AdviceContext = {
    playerName,
    formatName,
    games,
    wins,
    points,
    winRate,
    pointsPerGame,
  };

  if (games === 0) {
    return { ...buildDynamicMessage(newPlayerRecipe, context, seed), tone: 'new' };
  }

  if (winRate >= 70 || pointsPerGame >= 12) {
    return { ...buildDynamicMessage(humblingRecipe, context, seed), tone: 'humbling' };
  }

  if (winRate <= 30) {
    return { ...buildDynamicMessage(motivatingRecipe, context, seed), tone: 'motivating' };
  }

  return buildDynamicMessage(steadyRecipe, context, seed);
}
