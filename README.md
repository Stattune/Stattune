# STATTUNE

A black-and-emerald Spotify listening dashboard built with HTML, CSS and JavaScript.

## This project is configured for Vercel ONLY

The redirect URI is fixed in `app.js`:

`https://stattune.vercel.app/`

Do not use Live Server or `127.0.0.1` with this build.

## Deploy / update on GitHub and Vercel

1. Open your GitHub repository for STATTUNE.
2. Open the repository's root folder.
3. Upload or replace these files: `index.html`, `styles.css`, `app.js`, and `README.md`.
4. Commit the changes.
5. Vercel should automatically deploy the new commit.
6. Open `https://stattune.vercel.app/`.

## Spotify Developer Dashboard

In your Spotify app settings, add this exact Redirect URI:

`https://stattune.vercel.app/`

It must match the `REDIRECT_URI` in `app.js` exactly, including the final slash. Save the settings.

The Spotify Client ID is already included in `app.js`. This app uses Spotify Authorization Code with PKCE, so it does **not** need a Client Secret. Never paste a Client Secret into frontend code or GitHub.

## Features

- Spotify account connection using PKCE
- Profile and follower information
- Top artists and tracks (short-term / approximately last 4 weeks)
- Top genre estimate based on your top artists
- Recently played tracks
- Now-playing panel and playback status
- Play/pause, next, previous, shuffle and repeat controls
- Responsive desktop and mobile layout

## Notes

- Spotify playback controls can require Spotify Premium and an active Spotify device.
- Spotify may return no current track when nothing is playing.
- Your session tokens are stored in this browser's `sessionStorage`; disconnect clears them.
- Spotify API access and available data are controlled by Spotify and your app's developer settings.
