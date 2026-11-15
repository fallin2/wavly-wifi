'use client';
// Renders a hidden form targeting the router's link-login URL and auto-submits (or shows a tap target).
// The hotspot link comes from the redirect the router made to /login (?link=...), stashed by the server page.
import { useEffect, useState } from 'react';

export default function AutoConnect({ hotspotLink, auto = false }: { hotspotLink: string | null; auto?: boolean }) {
  const [creds, setCreds] = useState<{ username: string | null; secret: string | null } | null>(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    fetch('/api/me/hotspot', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCreds(d ?? { username: null, secret: null }))
      .catch(() => setCreds({ username: null, secret: null }));
  }, []);

  useEffect(() => {
    if (auto && creds?.username && creds?.secret && hotspotLink) {
      const t = setTimeout(() => {
        const form = document.getElementById('wavly-auto-connect') as HTMLFormElement | null;
        form?.submit();
        setTried(true);
      }, 800);
      return () => clearTimeout(t);
    }
  }, [auto, creds, hotspotLink]);

  if (!creds) return <p className="hint">Checking your WiFi credentials…</p>;
  if (!creds.username) {
    return <p className="hint">Buy a plan to get your WiFi login. Your credentials appear here after your first purchase or voucher redemption.</p>;
  }

  return (
    <div>
      <div className="kv"><dt>WiFi username</dt><dd className="mono">{creds.username}</dd></div>
      <div className="kv"><dt>WiFi password</dt><dd className="mono">{creds.secret}</dd></div>
      {hotspotLink ? (
        <form id="wavly-auto-connect" action={hotspotLink} method="post" style={{ marginTop: 12 }}>
          <input type="hidden" name="username" value={creds.username} />
          <input type="hidden" name="password" value={creds.secret ?? ''} />
          <button type="submit" className="btn btn-navy btn-block">Connect this phone now</button>
        </form>
      ) : (
        <p className="hint">Open this page from the WiFi network you&rsquo;re joining and a <b>Connect</b> button will appear here. On other pages, use the username and password above on the WiFi login screen.</p>
      )}
      {tried ? <p className="hint">Tried connecting — if you&rsquo;re still here, wait a minute for activation and tap the button again.</p> : null}
    </div>
  );
}
