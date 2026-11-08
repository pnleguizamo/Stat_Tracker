// Each handler returns normal player socket events; the server still owns scoring.
function seededRandom(seed) {
  let n = 2166136261;
  for (const c of String(seed)) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return () => {
    n += 0x6D2B79F5;
    let t = Math.imul(n ^ (n >>> 15), 1 | n);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function actionKey(state) {
  const r = state.currentRoundState;
  if (state.phase !== 'inGame' || !r || !r.id) return null;
  const statuses = { HIGHER_LOWER: 'collecting', WHO_LISTENED_MOST: 'collecting',
    GUESS_SPOTIFY_WRAPPED: 'collecting', HEARDLE: 'guessing', HITSTER: 'placing' };
  if (r.status !== statuses[r.minigameId]) return null;
  return `${state.currentStageIndex}:${r.id}:${r.minigameId === 'HEARDLE' ? r.currentSnippetIndex : ''}`;
}

function makeActions(state, playerId, script = {}, random = Math.random, botIndex = 0) {
  const r = state.currentRoundState;
  const mine = r.answers?.[playerId];
  const event = (suffix, payload) => ({ event: `minigame:${r.minigameId}:${suffix}`, payload });
  if (r.minigameId === 'HIGHER_LOWER') {
    if (mine) return [];
    const choice = script.choice || (random() < 0.5 ? 'LEFT' : 'RIGHT');
    if (!['LEFT', 'RIGHT'].includes(choice)) throw new Error('choice must be LEFT or RIGHT');
    return [event('submitAnswer', { answer: { choice } })];
  }
  if (['WHO_LISTENED_MOST', 'GUESS_SPOTIFY_WRAPPED'].includes(r.minigameId)) {
    if (mine) return [];
    const players = state.players.filter(p => p.connected !== false);
    const target = script.targetUserId
      ? players.find(p => p.userId === script.targetUserId)
      : players[Math.floor(random() * players.length)];
    if (!target) throw new Error('No eligible vote target (check targetUserId)');
    return [event('submitAnswer', { answer: { targetPlayerId: target.playerId } })];
  }
  if (r.minigameId === 'HEARDLE') {
    const guesses = mine?.guesses || [];
    if (guesses.some(g => g.outcome === 'correct' || g.snippetIndex === r.currentSnippetIndex)) return [];
    const mode = script.guesses?.[r.currentSnippetIndex] ||
      (r.currentSnippetIndex >= botIndex % 3 ? 'correct' : 'wrong');
    if (mode === 'skip') return [event('giveUp', {
      expectedRoundId: r.id, expectedSnippetIndex: r.currentSnippetIndex,
    })];
    const guess = typeof mode === 'object' ? mode : mode === 'correct'
      ? { trackId: r.song.id, trackName: r.song.track_name, artistNames: r.song.artist_names || [] }
      : { trackId: 'bot-wrong-guess', trackName: 'A different song', artistNames: [] };
    return [event('submitGuess', { guess })];
  }
  if (r.minigameId === 'HITSTER') {
    if (mine?.placement?.confirmedAt != null) return [];
    const cards = r.timelines?.[playerId]?.cards || [];
    const gapIndex = script.gapIndex === 'correct'
      ? cards.filter(c => c.year < r.year).length
      : script.gapIndex ?? Math.floor(random() * (cards.length + 1));
    if (!Number.isInteger(gapIndex) || gapIndex < 0 || gapIndex > cards.length) {
      throw new Error('gapIndex outside this player timeline');
    }
    const actions = [];
    if (script.songGuess && !mine?.songGuess) {
      const guess = script.songGuess === 'correct'
        ? { trackId: r.song.id, trackName: r.song.track_name, artistNames: r.song.artist_names || [] }
        : script.songGuess;
      actions.push(event('submitSongGuess', { guess }));
    }
    actions.push(event('submitPlacement', { gapIndex, finalize: true }));
    return actions;
  }
  return [];
}
module.exports = { seededRandom, actionKey, makeActions };
