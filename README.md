# Stat_Tracker

## Rollups / Materialized Views
- Collections (Mongo): `user_track_daily` (per-user/track/day counts), `user_stats_daily` (per-user/day totals + bounded top lists), `user_snapshots` (fast windows: last7, last30, ytd, allTime).
- Metrics tracked: `plays`, `qualifiedPlays` (>= `QUALIFIED_PLAY_MS`, default 30000ms), `msPlayed`.
- Default top-list limits: daily=50, snapshots tracks=200, artists=100, albums=100, genres=50; tunable via env (`ROLLUP_DAILY_TOP_LIMIT`, `ROLLUP_TOP_TRACKS`, etc).
- Backfill everything from normalized streams: `npm run rollups:backfill` (requires Mongo URI/DB envs).
- Recurring updates (default 03:30 UTC, recomputes last 40 days + snapshots): `npm run rollups:worker` or set custom `ROLLUP_CRON`/`ROLLUP_RECENT_DAYS`.
- Data source: normalized `streams` collection (fact table). Dimension lookups come from `tracks` and `artists` caches; rollups tolerate missing metadata by keeping IDs with null display fields.
