/* STATTUNE — Spotify dashboard
   Vercel-only deployment. Uses Authorization Code with PKCE.
   Never put a Spotify client secret in this file.
*/
"use strict";

const CLIENT_ID = "03183da920204d4aa1457c74df0a18c3";
const REDIRECT_URI = "https://stattune.vercel.app/";
const AUTH_ENDPOINT = "https://accounts.spotify.com/authorize";
const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";
const SCOPES = [
  "user-read-private",
  "user-read-email",
  "user-top-read",
  "user-read-recently-played",
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-modify-playback-state"
].join(" ");

const $ = (id) => document.getElementById(id);
const state = {
  accessToken: null,
  refreshToken: null,
  tokenExpiresAt: 0,
  profile: null,
  playback: null,
  progressTimer: null,
  refreshTimer: null,
  shuffle: false,
  repeat: "off"
};

function toast(message) {
  const node = $("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 3400);
}
function setConnected(connected) {
  $("connectPanel").classList.toggle("hidden", connected);
  $("disconnectButton").disabled = !connected;
  $("sidebarStatus").textContent = connected ? "Connected to Spotify" : "Not connected";
  document.querySelector(".pulse-dot").classList.toggle("connected", connected);
  $("avatarButton").textContent = connected && state.profile ? (state.profile.display_name || "S").charAt(0).toUpperCase() : "?";
}
function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256(plain) {
  const data = new TextEncoder().encode(plain);
  return await crypto.subtle.digest("SHA-256", data);
}
function randomString(length = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, value => chars[value % chars.length]).join("");
}
async function login() {
  if (!window.isSecureContext && location.hostname !== "localhost") {
    toast("Spotify login needs a secure HTTPS website. Open the Vercel site.");
    return;
  }
  const verifier = randomString(64);
  const challenge = base64url(await sha256(verifier));
  sessionStorage.setItem("stattune_code_verifier", verifier);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SCOPES,
    state: randomString(20),
    show_dialog: "true"
  });
  sessionStorage.setItem("stattune_oauth_state", params.get("state"));
  window.location.assign(`${AUTH_ENDPOINT}?${params.toString()}`);
}
async function exchangeCode(code) {
  const verifier = sessionStorage.getItem("stattune_code_verifier");
  if (!verifier) throw new Error("Login session expired. Please connect Spotify again.");
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier
  });
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || "Could not finish Spotify login.");
  saveTokens(data);
  sessionStorage.removeItem("stattune_code_verifier");
}
function saveTokens(data) {
  state.accessToken = data.access_token;
  if (data.refresh_token) state.refreshToken = data.refresh_token;
  state.tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  sessionStorage.setItem("stattune_access_token", state.accessToken);
  sessionStorage.setItem("stattune_token_expiry", String(state.tokenExpiresAt));
  if (state.refreshToken) sessionStorage.setItem("stattune_refresh_token", state.refreshToken);
}
async function refreshAccessToken() {
  const refreshToken = state.refreshToken || sessionStorage.getItem("stattune_refresh_token");
  if (!refreshToken) throw new Error("Your Spotify session expired. Please connect again.");
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || "Spotify session expired. Reconnect your account.");
  saveTokens(data);
}
async function ensureToken() {
  if (!state.accessToken) state.accessToken = sessionStorage.getItem("stattune_access_token");
  if (!state.accessToken) throw new Error("Connect your Spotify account first.");
  const expiry = Number(sessionStorage.getItem("stattune_token_expiry") || 0);
  if (expiry && Date.now() > expiry - 60000) await refreshAccessToken();
}
async function api(path, options = {}) {
  await ensureToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${state.accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  if (response.status === 204) return null;
  if (response.status === 401) {
    await refreshAccessToken();
    return api(path, options);
  }
  if (response.status === 403) throw new Error("Spotify blocked this action. Some playback controls require Spotify Premium.");
  if (response.status === 429) throw new Error("Spotify rate limit reached. Wait a moment and try again.");
  if (!response.ok) {
    let message = `Spotify request failed (${response.status}).`;
    try { const error = await response.json(); message = error.error?.message || message; } catch (_) {}
    throw new Error(message);
  }
  return response.json();
}
function imageUrl(images, fallback = "") {
  return images && images.length ? images[0].url : fallback;
}
function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
function formatTime(ms) {
  const seconds = Math.max(0, Math.floor((ms || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function setImage(container, url, fallback = "♫") {
  if (!url) { container.innerHTML = `<span>${fallback}</span>`; return; }
  container.innerHTML = `<img src="${safeText(url)}" alt="" referrerpolicy="no-referrer">`;
}
function renderProfile(profile) {
  state.profile = profile;
  $("profileName").textContent = profile.display_name || "Spotify listener";
  $("profileEmail").textContent = profile.email || "Spotify account connected";
  $("profileCountry").textContent = profile.country || "—";
  $("profileType").textContent = profile.product ? profile.product.toUpperCase() : "—";
  $("profileId").textContent = profile.id || "—";
  if (profile.images?.length) setImage($("profileImage"), profile.images[0].url);
  else $("profileImage").textContent = (profile.display_name || "♫").charAt(0).toUpperCase();
  $("followersStat").textContent = profile.followers?.total?.toLocaleString() ?? "—";
  setConnected(true);
}
function renderArtists(artists) {
  const container = $("topArtists");
  if (!artists.length) { container.innerHTML = '<div class="empty-state">No top artists found yet.</div>'; return; }
  container.innerHTML = artists.slice(0, 5).map((artist, index) => `
    <div class="artist-row">
      <span class="row-number">${String(index + 1).padStart(2, "0")}</span>
      <img src="${safeText(imageUrl(artist.images))}" alt="" loading="lazy">
      <div class="row-main"><strong>${safeText(artist.name)}</strong><span>${safeText((artist.genres || []).slice(0, 2).join(" · ") || "Artist")}</span></div>
      <span class="row-rank">TOP ${index + 1}</span>
    </div>`).join("");
}
function renderTracks(tracks) {
  const container = $("topTracks");
  if (!tracks.length) { container.innerHTML = '<div class="empty-state">No top tracks found yet.</div>'; return; }
  container.innerHTML = tracks.slice(0, 5).map((track, index) => `
    <div class="track-row">
      <span class="row-number">${String(index + 1).padStart(2, "0")}</span>
      <img src="${safeText(imageUrl(track.album?.images))}" alt="" loading="lazy">
      <div class="row-main"><strong>${safeText(track.name)}</strong><span>${safeText((track.artists || []).map(a => a.name).join(", "))}</span></div>
      <span class="row-rank">#${index + 1}</span>
    </div>`).join("");
}
function renderRecent(items) {
  const container = $("recentTracks");
  if (!items.length) { container.innerHTML = '<div class="empty-state">No recent listening history found.</div>'; return; }
  container.innerHTML = items.slice(0, 6).map(item => {
    const track = item.track;
    const when = new Date(item.played_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    return `<div class="recent-row"><img src="${safeText(imageUrl(track.album?.images))}" alt="" loading="lazy"><div class="row-main"><strong>${safeText(track.name)}</strong><span>${safeText(track.artists?.map(a => a.name).join(", ") || "Unknown artist")} · ${safeText(when)}</span></div></div>`;
  }).join("");
}
function renderSnapshot(artists, tracks) {
  $("topArtistStat").textContent = artists[0]?.name || "—";
  $("topTrackStat").textContent = tracks[0]?.name || "—";
  const genreCounts = {};
  artists.forEach(artist => (artist.genres || []).forEach(genre => genreCounts[genre] = (genreCounts[genre] || 0) + 1));
  const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  $("topGenreStat").textContent = topGenre ? topGenre.replace(/\b\w/g, c => c.toUpperCase()) : "—";
}
function renderPlayback(data) {
  state.playback = data;
  const item = data?.item;
  if (!item) {
    $("nowTitle").textContent = "Nothing playing";
    $("nowArtist").textContent = "Start playing something on Spotify.";
    $("nowArt").innerHTML = '<div class="art-placeholder">♫</div>';
    $("progressBar").style.width = "0%";
    $("currentTime").textContent = "0:00";
    $("durationTime").textContent = "0:00";
    $("playPauseButton").textContent = "▶";
    $("playerHint").textContent = "No active track detected. Start playback on a Spotify device.";
    return;
  }
  $("nowTitle").textContent = item.name;
  $("nowArtist").textContent = item.artists?.map(a => a.name).join(", ") || "Unknown artist";
  setImage($("nowArt"), imageUrl(item.album?.images));
  $("durationTime").textContent = formatTime(item.duration_ms);
  $("currentTime").textContent = formatTime(data.progress_ms);
  $("progressBar").style.width = `${Math.min(100, (data.progress_ms / item.duration_ms) * 100)}%`;
  $("playPauseButton").textContent = data.is_playing ? "Ⅱ" : "▶";
  $("playerHint").textContent = data.is_playing ? `Playing on ${data.device?.name || "Spotify"}` : "Playback is paused.";
  $("shuffleButton").classList.toggle("selected", !!data.shuffle_state);
  $("repeatButton").classList.toggle("selected", data.repeat_state !== "off");
  state.shuffle = !!data.shuffle_state;
  state.repeat = data.repeat_state || "off";
}
async function loadDashboard() {
  try {
    const profile = await api("/me");
    renderProfile(profile);
    const [artistsData, tracksData, recentData, playback] = await Promise.all([
      api("/me/top/artists?limit=5&time_range=short_term"),
      api("/me/top/tracks?limit=5&time_range=short_term"),
      api("/me/player/recently-played?limit=6"),
      api("/me/player").catch(error => { console.warn(error); return null; })
    ]);
    const artists = artistsData?.items || [];
    const tracks = tracksData?.items || [];
    renderArtists(artists);
    renderTracks(tracks);
    renderRecent(recentData?.items || []);
    renderSnapshot(artists, tracks);
    renderPlayback(playback);
    toast("Spotify connected. Your dashboard is ready.");
    startPlaybackPolling();
  } catch (error) {
    console.error(error);
    toast(error.message || "Could not load your Spotify dashboard.");
  }
}
async function pollPlayback() {
  if (!state.accessToken) return;
  try { renderPlayback(await api("/me/player")); }
  catch (error) { console.warn("Playback refresh:", error.message); }
}
function startPlaybackPolling() {
  clearInterval(state.progressTimer);
  state.progressTimer = setInterval(pollPlayback, 12000);
}
async function playbackAction(path, method = "POST", body = null) {
  try {
    await api(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    setTimeout(pollPlayback, 500);
  } catch (error) { toast(error.message); }
}
async function togglePlay() {
  if (!state.playback?.item) { toast("Start a track on Spotify first."); return; }
  await playbackAction(state.playback.is_playing ? "/me/player/pause" : "/me/player/play");
}
async function toggleShuffle() {
  state.shuffle = !state.shuffle;
  await playbackAction(`/me/player/shuffle?state=${state.shuffle}`, "PUT");
}
async function toggleRepeat() {
  const modes = ["off", "context", "track"];
  state.repeat = modes[(modes.indexOf(state.repeat) + 1) % modes.length];
  await playbackAction(`/me/player/repeat?state=${state.repeat}`, "PUT");
}
async function handleOAuthReturn() {
  const params = new URLSearchParams(location.search);
  const error = params.get("error");
  const code = params.get("code");
  const returnedState = params.get("state");
  if (error) {
    history.replaceState({}, document.title, REDIRECT_URI);
    toast(`Spotify login cancelled: ${error}`);
    return;
  }
  if (!code) return;
  const expectedState = sessionStorage.getItem("stattune_oauth_state");
  if (expectedState && returnedState !== expectedState) {
    history.replaceState({}, document.title, REDIRECT_URI);
    toast("Security check failed. Please connect again.");
    return;
  }
  try {
    await exchangeCode(code);
    sessionStorage.removeItem("stattune_oauth_state");
    history.replaceState({}, document.title, REDIRECT_URI);
    await loadDashboard();
  } catch (err) {
    history.replaceState({}, document.title, REDIRECT_URI);
    toast(err.message);
  }
}
async function restoreSession() {
  state.accessToken = sessionStorage.getItem("stattune_access_token");
  state.refreshToken = sessionStorage.getItem("stattune_refresh_token");
  if (!state.accessToken) return;
  try { await loadDashboard(); }
  catch (error) { toast(error.message); }
}
function disconnect() {
  clearInterval(state.progressTimer);
  ["stattune_access_token", "stattune_refresh_token", "stattune_token_expiry", "stattune_code_verifier", "stattune_oauth_state"].forEach(key => sessionStorage.removeItem(key));
  state.accessToken = null;
  state.refreshToken = null;
  state.profile = null;
  state.playback = null;
  $("profileName").textContent = "Guest listener";
  $("profileEmail").textContent = "Not connected";
  $("profileCountry").textContent = "—";
  $("profileType").textContent = "—";
  $("profileId").textContent = "—";
  $("followersStat").textContent = "—";
  $("topArtistStat").textContent = "—";
  $("topTrackStat").textContent = "—";
  $("topGenreStat").textContent = "—";
  $("topArtists").innerHTML = '<div class="empty-state">Your top artists will appear here.</div>';
  $("topTracks").innerHTML = '<div class="empty-state">Your top tracks will appear here.</div>';
  $("recentTracks").innerHTML = '<div class="empty-state">Your recent listening history will appear here.</div>';
  renderPlayback(null);
  setConnected(false);
  toast("Spotify account disconnected from this browser.");
}
function wireEvents() {
  $("connectButton").addEventListener("click", login);
  $("disconnectButton").addEventListener("click", disconnect);
  $("playPauseButton").addEventListener("click", togglePlay);
  $("previousButton").addEventListener("click", () => playbackAction("/me/player/previous"));
  $("nextButton").addEventListener("click", () => playbackAction("/me/player/next"));
  $("shuffleButton").addEventListener("click", toggleShuffle);
  $("repeatButton").addEventListener("click", toggleRepeat);
  $("avatarButton").addEventListener("click", () => {
    if (state.profile) document.querySelector(".profile-panel").scrollIntoView({ behavior: "smooth", block: "center" });
    else toast("Connect Spotify to view your account.");
  });
}
document.addEventListener("DOMContentLoaded", async () => {
  wireEvents();
  await handleOAuthReturn();
  if (!new URLSearchParams(location.search).has("code")) await restoreSession();
});
