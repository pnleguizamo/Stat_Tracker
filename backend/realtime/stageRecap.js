// Computes per-stage recap awards from round history and scoreboard data.
// Returns a light { stageIndex, minigameId, isFinal, awards[] } object.

function playerProfile(room, playerId) {
  const p = room.players.get(playerId);
  return {
    playerId,
    displayName: p?.displayName || p?.name || 'Player',
    avatar: p?.avatar || null,
  };
}

function formatElapsed(ms) {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds === 0) return '0s';
  if (Number.isInteger(seconds)) return `${seconds}s`;
  return `${seconds.toFixed(1)}s`;
}

function computeFastestCorrectAverages(history, { excludeOwner = false } = {}) {
  const totalsByPlayer = {};
  const countsByPlayer = {};

  for (const round of history) {
    const startedAt = round?.startedAt;
    const answers = round?.answers || {};
    const ownerId = round?.ownerPlayerId;
    if (typeof startedAt !== 'number') continue;

    const winners = (round?.results?.winners || []).filter(
      (playerId) => !(excludeOwner && playerId === ownerId)
    );

    for (const playerId of winners) {
      const answeredAt = answers?.[playerId]?.at;
      if (typeof answeredAt !== 'number') continue;
      const elapsedMs = Math.max(0, answeredAt - startedAt);
      totalsByPlayer[playerId] = (totalsByPlayer[playerId] || 0) + elapsedMs;
      countsByPlayer[playerId] = (countsByPlayer[playerId] || 0) + 1;
    }
  }

  return Object.keys(countsByPlayer).map((playerId) => ({
    playerId,
    avgMs: totalsByPlayer[playerId] / countsByPlayer[playerId],
    correctCount: countsByPlayer[playerId],
  }));
}

function wlmAwards(history, room, { includeAllValid = false } = {}) {
  const candidates = [];

  // Aggregate listen counts and vote tallies per player across all rounds
  const totalListens = {};
  const totalVotesReceived = {};
  const totalVotesCast = {};
  const topListenerRounds = {};

  for (const round of history) {
    const listenCounts = round.prompt?.listenCounts || {};
    const results = round.results;
    if (!results) continue;

    let maxListens = 0;
    for (const [userId, count] of Object.entries(listenCounts)) {
      if (count > maxListens) maxListens = count;
    }

    const userIdToPlayerId = {};
    room.players.forEach((player, playerId) => {
      if (player.userId) userIdToPlayerId[player.userId] = playerId;
    });

    for (const [userId, count] of Object.entries(listenCounts)) {
      const pid = userIdToPlayerId[userId];
      if (!pid) continue;
      totalListens[pid] = (totalListens[pid] || 0) + count;
      if (count === maxListens && maxListens > 0) {
        topListenerRounds[pid] = (topListenerRounds[pid] || 0) + 1;
      }
    }

    const tally = results.tally || {};
    for (const [pid, votes] of Object.entries(tally)) {
      totalVotesReceived[pid] = (totalVotesReceived[pid] || 0) + votes;
    }

    // Correct votes
    for (const winnerId of results.winners || []) {
      totalVotesCast[winnerId] = (totalVotesCast[winnerId] || 0) + 1;
    }
  }

  const playerIds = Array.from(room.players.keys());
  if (playerIds.length < 2) return [];

  // Hit Hoarder — highest total listen count
  {
    const sorted = playerIds
      .filter((p) => (totalListens[p] || 0) > 0)
      .sort((a, b) => (totalListens[b] || 0) - (totalListens[a] || 0));
    if (sorted.length >= (includeAllValid ? 1 : 2)) {
      const max = totalListens[sorted[0]] || 0;
      const avg = playerIds.reduce((s, p) => s + (totalListens[p] || 0), 0) / playerIds.length;
      const interestScore = avg > 0 ? max / avg : 0;
      const winners = sorted.filter((p) => totalListens[p] === max);
      candidates.push({
        id: 'hit_hoarder',
        title: 'Hit Hoarder',
        description: `Racked up ${max} total plays. The group averaged ${Math.round(avg)}.`,
        featuredPlayers: winners.map((p) => ({
          ...playerProfile(room, p),
          statLabel: `${totalListens[p]} plays`,
        })),
        interestScore,
      });
    }
  }

  // Most Deceiving — top listener who got the fewest votes
  {
    const topListeners = playerIds.filter((p) => (topListenerRounds[p] || 0) > 0);
    if (topListeners.length > 0) {
      const ghost = topListeners.reduce((best, p) =>
        (totalVotesReceived[p] || 0) < (totalVotesReceived[best] || 0) ? p : best
      );
      const theirVotes = totalVotesReceived[ghost] || 0;
      const avgVotes =
        playerIds.reduce((s, p) => s + (totalVotesReceived[p] || 0), 0) / playerIds.length;
      const interestScore = avgVotes > 0 ? (avgVotes - theirVotes) / avgVotes : 0;
      if (includeAllValid || interestScore > 0.2) {
        candidates.push({
          id: 'stealthy_streamer',
          title: 'Stealthy Streamer',
          description: `Was the top listener ${topListenerRounds[ghost]}x but only got ${theirVotes} votes. Under the radar.`,
          featuredPlayers: [{ ...playerProfile(room, ghost), statLabel: `${theirVotes} votes received` }],
          interestScore,
        });
      }
    }
  }

  // Stream Seer — most correct votes cast
  {
    const sorted = playerIds
      .filter((p) => (totalVotesCast[p] || 0) > 0)
      .sort((a, b) => (totalVotesCast[b] || 0) - (totalVotesCast[a] || 0));
    if (sorted.length > 0) {
      const max = totalVotesCast[sorted[0]];
      const winners = sorted.filter((p) => totalVotesCast[p] === max);
      candidates.push({
        id: 'stream_seer',
        title: 'Stream Seer',
        description: `Voted correctly ${max} time${max !== 1 ? 's' : ''} this stage. Knows ball.`,
        featuredPlayers: winners.map((p) => ({
          ...playerProfile(room, p),
          statLabel: `${totalVotesCast[p]} correct`,
        })),
        interestScore: max,
      });
    }
  }

  // Rapid Read — fastest average correct answer
  {
    const averages = computeFastestCorrectAverages(history)
      .sort((a, b) => a.avgMs - b.avgMs);
    if (averages.length >= (includeAllValid ? 1 : 2)) {
      const minAvg = averages[0].avgMs;
      const secondAvg = averages[1]?.avgMs ?? minAvg;
      const interestScore = Math.max(0.05, (secondAvg - minAvg) / 1000);
      const winners = averages.filter((entry) => entry.avgMs === minAvg);
      candidates.push({
        id: 'rapid_read',
        title: 'Rapid Read',
        description: `Averaged ${formatElapsed(minAvg)} on correct guesses. Give your fingers a break.`,
        featuredPlayers: winners.map((entry) => ({
          ...playerProfile(room, entry.playerId),
          statLabel: `avg ${formatElapsed(entry.avgMs)}`,
        })),
        interestScore,
      });
    }
  }

  // Crowd Favorite — most votes received
  {
    const sorted = playerIds
      .filter((p) => (totalVotesReceived[p] || 0) > 0)
      .sort((a, b) => (totalVotesReceived[b] || 0) - (totalVotesReceived[a] || 0));
    if (sorted.length >= (includeAllValid ? 1 : 2)) {
      const max = totalVotesReceived[sorted[0]];
      const secondMax = totalVotesReceived[sorted[1]] || 0;
      const interestScore = secondMax > 0 ? max / secondMax : max;
      const winners = sorted.filter((p) => totalVotesReceived[p] === max);
      // skip if same person as hit hoarder (avoid repetition)
      const hitHoarder = candidates.find((c) => c.id === 'hit_hoarder');
      const overlap = hitHoarder?.featuredPlayers.every((fp) =>
        winners.some((w) => w === fp.playerId)
      );
      if (includeAllValid || !overlap) {
        candidates.push({
          id: 'crowd_favorite',
          title: 'Crowd Favorite',
          description: `Was voted ${max} times. Justified?`,
          featuredPlayers: winners.map((p) => ({
            ...playerProfile(room, p),
            statLabel: `${totalVotesReceived[p]} votes`,
          })),
          interestScore,
        });
      }
    }
  }

  return candidates;
}

function heardleAwards(scoreboard, stageIndex, room, { includeAllValid = false } = {}) {
  const candidates = [];
  const playerIds = Array.from(room.players.keys());
  if (playerIds.length < 1) return [];

  const snippetIndices = {};

  for (const [playerId, entry] of Object.entries(scoreboard)) {
    const stageAwards = (entry.awards || []).filter(
      (a) => a.meta?.stageIndex === stageIndex && a.meta?.minigameId === 'HEARDLE'
    );
    for (const award of stageAwards) {
      if (typeof award.meta?.snippetIndex === 'number') {
        snippetIndices[playerId] = snippetIndices[playerId] || [];
        snippetIndices[playerId].push(award.meta.snippetIndex);
      }
    }
  }

  const avgSnippet = (playerId) => {
    const arr = snippetIndices[playerId];
    if (!arr?.length) return null;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  };

  const correctPlayers = playerIds.filter((p) => snippetIndices[p]?.length > 0);

  // Fastest Ear — lowest avg snippet index
  if (correctPlayers.length >= (includeAllValid ? 1 : 2)) {
    const sorted = correctPlayers.sort((a, b) => avgSnippet(a) - avgSnippet(b));
    const minAvg = avgSnippet(sorted[0]);
    const maxAvg = avgSnippet(sorted[sorted.length - 1]);
    const interestScore = maxAvg - minAvg;
    const winners = sorted.filter((p) => avgSnippet(p) === minAvg);
    candidates.push({
      id: 'john_heardle',
      title: 'John Heardle',
      description: `Identified songs on snippet ${minAvg < 1 ? '1' : (minAvg + 1).toFixed(1)} on average. Get a job.`,
      featuredPlayers: winners.map((p) => ({
        ...playerProfile(room, p),
        statLabel: `avg snippet ${(minAvg + 1).toFixed(1)}`,
      })),
      interestScore,
    });
  }

  // Still Processing — highest avg snippet or no correct answers
  {
    const allPlayers = playerIds;
    const withAvg = allPlayers.map((p) => ({ p, avg: avgSnippet(p) ?? 7 }));
    withAvg.sort((a, b) => b.avg - a.avg);
    if (withAvg.length > 0) {
      const maxAvg = withAvg[0].avg;
      const winners = withAvg.filter((x) => x.avg === maxAvg).map((x) => x.p);
      const label = maxAvg >= 7 ? 'never got it' : `avg snippet ${(maxAvg + 1).toFixed(1)}`;
      candidates.push({
        id: 'still_processing',
        title: 'Still Processing',
        description:
          maxAvg >= 7
            ? `Needed the full song every time. A journey, not a destination.`
            : `Needed snippet ${(maxAvg + 1).toFixed(1)} on average. Getting there.`,
        featuredPlayers: winners.map((p) => ({
          ...playerProfile(room, p),
          statLabel: label,
        })),
        interestScore: maxAvg,
      });
    }
  }

  // Clutch — got correct on snippet index 5 or 6 (last two)
  {
    const clutchPlayers = playerIds.filter((p) =>
      (snippetIndices[p] || []).some((si) => si >= 5)
    );
    if (clutchPlayers.length > 0) {
      candidates.push({
        id: 'clutch_gene',
        title: 'Clutch Gene',
        description: `Got it right on the last possible snippets. Clutch comes naturally.`,
        featuredPlayers: clutchPlayers.map((p) => ({
          ...playerProfile(room, p),
          statLabel: `snippet ${Math.max(...(snippetIndices[p] || [0]).filter((si) => si >= 5)) + 1}`,
        })),
        interestScore: 1,
      });
    }
  }

  return candidates;
}

function wrappedAwards(history, room, scoreboard, stageIndex, { includeAllValid = false } = {}) {
  const candidates = [];
  const playerIds = Array.from(room.players.keys());
  if (playerIds.length < 2 || history.length === 0) return [];

  const ownerGuessStats = {};
  const minutesByOwner = {};

  for (const round of history) {
    const ownerId = round.ownerPlayerId;
    if (!ownerId) continue;
    const winners = round.results?.winners || [];
    const totalVoters = playerIds.filter((p) => p !== ownerId).length;
    const correctGuesses = winners.filter((w) => w !== ownerId).length;
    if (!ownerGuessStats[ownerId]) {
      ownerGuessStats[ownerId] = {
        correct: 0,
        total: 0,
        appearances: 0,
        perfectRounds: 0,
        zeroRounds: 0,
      };
    }
    const roundFraction = totalVoters > 0 ? correctGuesses / totalVoters : 0;
    ownerGuessStats[ownerId].correct += correctGuesses;
    ownerGuessStats[ownerId].total += totalVoters;
    ownerGuessStats[ownerId].appearances += 1;
    if (roundFraction === 1) ownerGuessStats[ownerId].perfectRounds += 1;
    if (roundFraction === 0) ownerGuessStats[ownerId].zeroRounds += 1;
    if (typeof round.prompt?.minutesListened === 'number') {
      const minutes = round.prompt.minutesListened;
      const currentBest = minutesByOwner[ownerId];
      if (!currentBest || minutes > currentBest.minutes) {
        minutesByOwner[ownerId] = {
          minutes,
          year: round.prompt?.year || null,
        };
      }
    }
  }

  const ownerStats = Object.fromEntries(
    Object.entries(ownerGuessStats).map(([ownerId, stats]) => [
      ownerId,
      {
        ...stats,
        fraction: stats.total > 0 ? stats.correct / stats.total : 0,
      },
    ])
  );

  // Crypto Wrapped (Niche Ninja) — fewest correct guesses
  {
    // Priority order: lowest aggregate correct fraction, then most zero-correct rounds,
    // then more owner appearances, then fewer total correct guesses.
    const sorted = Object.entries(ownerStats).sort(([, a], [, b]) => {
      if (a.fraction !== b.fraction) return a.fraction - b.fraction;
      if (a.zeroRounds !== b.zeroRounds) return b.zeroRounds - a.zeroRounds;
      if (a.appearances !== b.appearances) return b.appearances - a.appearances;
      return a.correct - b.correct;
    });
    if (sorted.length > 0) {
      const best = sorted[0][1];
      const minFrac = best.fraction;
      const zeroRounds = best.zeroRounds;
      const winners = sorted
        .filter(([, stats]) =>
          stats.fraction === best.fraction &&
          stats.zeroRounds === best.zeroRounds &&
          stats.appearances === best.appearances &&
          stats.correct === best.correct
        )
        .map(([playerId]) => playerId);
      const pct = Math.round(minFrac * 100);
      candidates.push({
        id: 'niche_ninja',
        title: 'Niche Ninja',
        description:
          pct === 0
            ? `Nobody in the group guessed their Wrappeds correctly. ${zeroRounds} wrapped${zeroRounds !== 1 ? 's' : ''} got zero correct guesses. Just too niche.`
            : `Only ${pct}% of the group guessed their Wrappeds correctly. ${zeroRounds} wrapped${zeroRounds !== 1 ? 's' : ''} got zero correct guesses. Just too niche.`,
        featuredPlayers: winners.map((playerId) => ({
          ...playerProfile(room, playerId),
          statLabel: `${pct}% guessed right`,
        })),
        interestScore: 1 - minFrac,
      });
    }
  }

  // Open Book — most guessed correctly
  {
    const sorted = Object.entries(ownerStats).sort(([, a], [, b]) => {
      if (a.perfectRounds !== b.perfectRounds) return b.perfectRounds - a.perfectRounds;
      if (a.fraction !== b.fraction) return b.fraction - a.fraction;
      if (a.appearances !== b.appearances) return b.appearances - a.appearances;
      return b.correct - a.correct;
    });
    if (sorted.length > 0) {
      const best = sorted[0][1];
      const maxPerfectRounds = best.perfectRounds;
      const winners = sorted
        .filter(([, stats]) =>
          stats.perfectRounds === best.perfectRounds &&
          stats.fraction === best.fraction &&
          stats.appearances === best.appearances &&
          stats.correct === best.correct
        )
        .map(([playerId]) => playerId);
      if (maxPerfectRounds > 0) {
        const pct = Math.round(best.fraction * 100);
        candidates.push({
          id: 'open_book',
          title: 'Open Book',
          description:
            `${maxPerfectRounds} Wrapped${maxPerfectRounds !== 1 ? 's' : ''} got guessed perfectly by the whole group. ` +
            `${pct}% of guesses landed across all their Wrappeds.`,
          featuredPlayers: winners.map((playerId) => ({
            ...playerProfile(room, playerId),
            statLabel: `${maxPerfectRounds} perfect ${maxPerfectRounds === 1 ? 'round' : 'rounds'}`,
          })),
          interestScore: maxPerfectRounds + best.fraction,
        });
      }
    }
  }

  // Fast Finder — fastest average correct Wrapped guess
  {
    const averages = computeFastestCorrectAverages(history, { excludeOwner: true })
      .sort((a, b) => a.avgMs - b.avgMs);
    if (averages.length >= (includeAllValid ? 1 : 2)) {
      const minAvg = averages[0].avgMs;
      const secondAvg = averages[1]?.avgMs ?? minAvg;
      const interestScore = Math.max(0.05, (secondAvg - minAvg) / 1000);
      const winners = averages.filter((entry) => entry.avgMs === minAvg);
      candidates.push({
        id: 'fast_finder',
        title: 'Fast Finder',
        description: `Averaged ${formatElapsed(minAvg)} on correct Wrapped guesses. Bro think they a prophet.`,
        featuredPlayers: winners.map((entry) => ({
          ...playerProfile(room, entry.playerId),
          statLabel: `avg ${formatElapsed(entry.avgMs)}`,
        })),
        interestScore,
      });
    }
  }

  // Wrapped Wrangler — most correct guesses cast
  {
    const correctCasts = {};
    for (const [playerId, entry] of Object.entries(scoreboard)) {
      const stageCorrect = (entry.awards || []).filter(
        (a) => a.meta?.stageIndex === stageIndex && a.meta?.minigameId === 'GUESS_SPOTIFY_WRAPPED' && a.reason === 'correct'
      ).length;
      if (stageCorrect > 0) correctCasts[playerId] = stageCorrect;
    }
    const sorted = Object.entries(correctCasts).sort(([, a], [, b]) => b - a);
    if (sorted.length > 0) {
      const max = sorted[0][1];
      const winners = sorted.filter(([, v]) => v === max).map(([p]) => p);
      candidates.push({
        id: 'wrapped_wrangler',
        title: 'Wrapped Wrangler',
        description: `Guessed ${max} Wrapped${max !== 1 ? 's' : ''} right. Definitely abuses the Sea Shanty method.`,
        featuredPlayers: winners.map((p) => ({
          ...playerProfile(room, p),
          statLabel: `${correctCasts[p]} correct`,
        })),
        interestScore: max,
      });
    }
  }

  // Minutes Monster — highest minutesListened
  {
    const sorted = Object.entries(minutesByOwner).sort(([, a], [, b]) => b.minutes - a.minutes);
    if (sorted.length >= (includeAllValid ? 1 : 2)) {
      const [monsterId, monsterData] = sorted[0];
      const maxMin = monsterData.minutes || 0;
      const yearLabel = monsterData.year || 'an unknown year';
      const avgMin =
        Object.values(minutesByOwner).reduce((s, v) => s + (v.minutes || 0), 0) / Object.values(minutesByOwner).length;
      const interestScore = avgMin > 0 ? maxMin / avgMin : 0;
      if ((includeAllValid && maxMin > 0) || interestScore > 1.3) {
        candidates.push({
          id: 'minutes_monster',
          title: 'Minutes Monster',
          description: `Clocked ${maxMin.toLocaleString()} minutes of listening in ${yearLabel}. The group averaged ${Math.round(avgMin).toLocaleString()} per year.`,
          featuredPlayers: [
            {
              ...playerProfile(room, monsterId),
              statLabel: `${maxMin.toLocaleString()} min (${yearLabel})`,
            },
          ],
          interestScore,
        });
      }
    }
  }

  return candidates;
}

function computeStageRecap(room, stageIndex, maxAwards = 3) {
  const stageConfig = room.stagePlan?.[stageIndex];
  if (!stageConfig) return null;

  const minigameId = stageConfig.minigameId;
  const isFinal = stageIndex === (room.stagePlan.length - 1);
  const history = room.stageRoundHistory?.[stageIndex] || [];
  const scoreboard = room.scoreboard || {};
  const includeAllValid = maxAwards === Infinity;

  let candidates = [];

  if (minigameId === 'WHO_LISTENED_MOST') {
    candidates = wlmAwards(history, room, { includeAllValid });
  } else if (minigameId === 'HEARDLE') {
    candidates = heardleAwards(scoreboard, stageIndex, room, { includeAllValid });
  } else if (minigameId === 'GUESS_SPOTIFY_WRAPPED') {
    candidates = wrappedAwards(history, room, scoreboard, stageIndex, { includeAllValid });
  }

  const awards = candidates
    .filter((c) => c.featuredPlayers?.length > 0 && (includeAllValid || c.interestScore > 0))
    .sort((a, b) => b.interestScore - a.interestScore)
    .slice(0, maxAwards)
    .map(({ id, title, description, featuredPlayers }) => ({ id, title, description, featuredPlayers }));

  return { stageIndex, minigameId, isFinal, awards };
}

module.exports = { computeStageRecap };
