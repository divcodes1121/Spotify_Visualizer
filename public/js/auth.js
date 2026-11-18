// Spotify login using Authorization Code + PKCE (no client secret needed, safe for local apps).
const K = { client: 'aura.clientId', tokens: 'aura.tokens', verifier: 'aura.pkce', state: 'aura.oauthState' };

export const SCOPES = [
  'streaming',                    // Web Playback SDK (play inside Aura, Premium)
  'user-read-email', 'user-read-private',
  'user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing',
  'user-library-read', 'playlist-read-private', 'playlist-read-collaborative',
  'user-read-recently-played', 'user-top-read',
];

export const REDIRECT_URI = `${location.origin}/callback`;

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = (len = 64) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), (b) => chars[b % chars.length]).join('');
};

let refreshing = null;

export const Auth = {
  getClientId: () => localStorage.getItem(K.client) || '',
  setClientId: (id) => localStorage.setItem(K.client, id.trim()),

  tokens() {
    try { return JSON.parse(localStorage.getItem(K.tokens)) || null; } catch { return null; }
  },
  isLoggedIn() { return !!this.tokens()?.refresh_token && !!this.getClientId(); },

  async login() {
    const clientId = this.getClientId();
    if (!clientId) throw new Error('Add your Spotify Client ID first.');
    const verifier = randomString(64);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const state = randomString(16);
    localStorage.setItem(K.verifier, verifier);
    localStorage.setItem(K.state, state);
    const params = new URLSearchParams({
      response_type: 'code', client_id: clientId, scope: SCOPES.join(' '),
      code_challenge_method: 'S256', code_challenge: challenge, redirect_uri: REDIRECT_URI, state,
    });
    location.href = `https://accounts.spotify.com/authorize?${params}`;
  },

  // Returns true if we just finished a login redirect.
  async handleCallback() {
    if (location.pathname !== '/callback') return false;
    const q = new URLSearchParams(location.search);
    history.replaceState(null, '', '/');
    if (q.get('error')) throw new Error(`Spotify login cancelled (${q.get('error')})`);
    const code = q.get('code');
    if (!code) return false;
    if (q.get('state') !== localStorage.getItem(K.state)) throw new Error('Login state mismatch — please try again.');
    const body = new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
      client_id: this.getClientId(), code_verifier: localStorage.getItem(K.verifier) || '',
    });
    await this._token(body);
    localStorage.removeItem(K.verifier);
    localStorage.removeItem(K.state);
    return true;
  },

  async _token(body) {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(j.error_description || j.error || `Token request failed (${r.status})`);
      err.status = r.status;
      throw err;
    }
    const prev = this.tokens() || {};
    const tokens = {
      access_token: j.access_token,
      refresh_token: j.refresh_token || prev.refresh_token,
      expires_at: Date.now() + (j.expires_in || 3600) * 1000,
      scope: j.scope,
    };
    localStorage.setItem(K.tokens, JSON.stringify(tokens));
    return tokens;
  },

  async getToken() {
    const t = this.tokens();
    if (!t) throw Object.assign(new Error('Not logged in'), { status: 401 });
    if (Date.now() < t.expires_at - 60_000) return t.access_token;
    if (!refreshing) {
      refreshing = this._token(new URLSearchParams({
        grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: this.getClientId(),
      })).finally(() => { refreshing = null; });
    }
    try {
      return (await refreshing).access_token;
    } catch (e) {
      if (e.status === 400 || e.status === 401) this.logout();
      throw e;
    }
  },

  logout() { localStorage.removeItem(K.tokens); },
};
