const test = require('node:test');
const assert = require('node:assert/strict');
const { getTrackPreview } = require('./spotifyServices');

test('preview search falls back to plain text and excludes covers and different titles', async (t) => {
  const queries = [];
  t.mock.method(global, 'fetch', async (url) => {
    queries.push(new URL(url).searchParams.get('q'));
    return { ok: true, json: async () => ({ data: queries.length === 1 ? [] : [
      { title: 'Blinding Lights', artist: { name: 'A Cover Artist' }, preview: 'wrong-cover' },
      { title: 'Blinding Lights (Acoustic)', artist: { name: 'The Weeknd' }, preview: 'wrong-version' },
      { title: 'Blinding Lights', artist: { name: 'The Weeknd' }, preview: 'correct-preview' },
    ] }) };
  });
  const result = await getTrackPreview('Blinding Lights', 'The Weeknd');
  assert.deepEqual(queries, ['track:"Blinding Lights" artist:"The Weeknd"', 'Blinding Lights The Weeknd']);
  assert.equal(result.previewUrl, 'correct-preview');
  assert.equal(result.tracks.length, 1);
});

test('preview search preserves existing structured search matches', async (t) => {
  let calls = 0;
  t.mock.method(global, 'fetch', async () => {
    calls++;
    return { ok: true, json: async () => ({ data: [
      { title: 'Take on Me', artist: { name: 'a-ha' }, preview: 'original' },
    ] }) };
  });
  assert.equal((await getTrackPreview('Take on Me', 'a-ha')).previewUrl, 'original');
  assert.equal(calls, 1);
});

test('preview search does not treat an API error as an empty catalogue result', async (t) => {
  let calls = 0;
  t.mock.method(global, 'fetch', async () => {
    calls++;
    return { ok: true, json: async () => ({ error: { message: 'Quota exceeded', code: 4 } }) };
  });
  assert.equal((await getTrackPreview('Take on Me', 'a-ha')).previewUrl, null);
  assert.equal(calls, 1);
});
