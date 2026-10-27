# Artist Ranker (Deezer edition)

Rank every song an artist is on (their own songs, collabs and features), two songs at a time.
Song lists and 30-second previews come from Deezer's public API, so there's no login, no developer app and no quota to run out of.
Works for any artist; each artist gets its own save.

The Spotify edition lives at https://ellioshow1.github.io/artist-ranker/ and plays full songs, but needs everyone to set up a Spotify developer app.

## Run it on your computer

Double-click `start.bat`. It serves the app at http://127.0.0.1:8767/ and opens it.
(Or run `python -m http.server 8767 --bind 127.0.0.1` in this folder.)

## Share it with friends

It's a plain static site (no server code), hosted on GitHub Pages at https://ellioshow1.github.io/artist-ranker-deezer/.
Friends just open the link. Everyone's progress lives in their own browser.

## Exporting

- **Copy as text / Copy Deezer links / Download CSV**: no setup.
- **Save as a Spotify playlist (optional)**: needs a Spotify developer app, the same as the Spotify edition
  (add `https://ellioshow1.github.io/artist-ranker-deezer/` as a Redirect URI). Each song is matched on Spotify by ISRC
  (one Spotify request per song, remembered afterwards), so start with your top songs to stay inside Spotify's request limits.

## How the scan works

1. Every release on the artist's Deezer page (albums, singles, EPs, compilations) and every track on them.
2. Features: Deezer has no "appears on" list, so the artist's top 100 tracks and a search for their name are checked,
   and a song is kept only if Deezer credits the artist on it. Missing something? Paste its Deezer track link on the Songs tab.

Deezer allows 50 requests per 5 seconds; the app paces itself under that.

## How the ranking works

1. **Swiss rounds.** Every song plays every round against a song with a similar record. Nobody gets knocked out.
2. **Finals.** The top songs (50 by default) get sorted exactly, head to head, reusing picks already made. Extend 25 at a time.
3. Everything below the finals is ordered by a Bradley-Terry rating fitted on every pick.

Keys: `←`/`→` pick, `↓` can't split them, `S` ask me later, `Z` undo, `A`/`D` play/pause left/right.

## Files

- `js/deezer.js`: artist search, catalog scan, preview links (JSONP, since Deezer sends no CORS headers)
- `js/spotify.js`: optional Spotify login (PKCE), song matching and playlist export
- `js/config.js`: optional shared Spotify Client ID for the export
- `js/catalog.js`: merges duplicates (single + album + deluxe + clean) and tags sped-up/instrumental/remix/live versions
- `js/engine.js`: Swiss pairing, finals insertion sort, ratings
- `js/app.js`: UI, preview players and per-artist saves
