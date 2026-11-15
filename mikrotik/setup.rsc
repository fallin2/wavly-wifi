# Wavly WiFi — MikroTik setup (RouterOS v7)
# Import:  /import file-name=setup.rsc
# Edit ONLY the variables in the "CONFIG" section, then run verification commands from docs/mikrotik.md.
# Safe to re-run: existing objects are updated in place where RouterOS allows; otherwise guarded by on-error.

# ─── CONFIG ──────────────────────────────────────────────────────────────────
:local wanif        "ether1"                 # port from Starlink Mini ethernet output
:local lanif        "bridge-hotspot"         # LAN bridge (wlan + LAN ethers)
:local hotspotNet   "192.168.88.0/24"
:local hotspotGw    "192.168.88.1"
:local poolName     "wavly-pool"
:local poolRange    "192.168.88.100-192.168.88.250"
:local hsServerProf "wavly-hs-profile"
:local hsUserProf   "wavly-std-5m"           # default profile for CLI-created users
:local hsServer     "wavly-hotspot"
:local portalHost   "portal.REPLACE-ME.example"  # e.g. wavly.com.gh (or *.vercel.app for MVP)
:local dnsA         "1.1.1.1"                # consider 208.67.222.222/208.67.220.220 (OpenDNS) for content filtering
:local dnsB         "8.8.8.8"

# ─── 1. WAN (ether1) via Starlink DHCP ───────────────────────────────────────
/ip dhcp-client
:do { add interface=$wanif disabled=no add-default-route=yes use-peer-dns=no comment="wavly-wan" } \
  on-error={ :put "WAN dhcp-client exists or failed — check manually" }

/ip dns set servers=$dnsA,$dnsB allow-remote-requests=yes cache-size=4096
/system ntp client set enabled=yes servers=time.google.com,time.cloudflare.com   # TLS certs need sane clock

# ─── 2. LAN addresses, pool, DHCP ─────────────────────────────────────────────
:if ([:len [/ip address find interface=$lanif address="$hotspotGw/24"]] = 0) do={
  /ip address add address="$hotspotGw/24" interface=$lanif comment="wavly-hotspot-gw"
}
:if ([:len [/ip pool find name=$poolName]] = 0) do={
  /ip pool add name=$poolName ranges=$poolRange
}
:if ([:len [/ip dhcp-server find name="wavly-dhcp"]] = 0) do={
  /ip dhcp-server add name="wavly-dhcp" interface=$lanif address-pool=$poolName lease-time=1h disabled=no
  /ip dhcp-server network add address=$hotspotNet gateway=$hotspotGw dns-server=$hotspotGw comment="wavly-hotspot-net"
}

# ─── 3. NAT + firewall (hotspot traffic must be allowed; fasttrack must go) ──
/ip firewall nat
:if ([:len [/ip firewall nat find comment="wavly-masquerade"]] = 0) do={
  add chain=srcnat src-address=$hotspotNet action=masquerade out-interface=$wanif comment="wavly-masquerade"
}

# FastTrack bypasses per-user queues and breaks bandwidth limits — disable it.
:do { /ip firewall filter set [find comment~"fasttrack"] disabled=yes } \
  on-error={ :put "No defconf fasttrack rule found — verify /ip firewall filter manually" }

# Input chain hardening (append; verify ordering with: /ip firewall filter print where chain=input)
/ip firewall filter
:if ([:len [find comment="wavly-input-allow-established"]] = 0) do={
  add chain=input connection-state=established,related action=accept comment="wavly-input-allow-established"
  add chain=input connection-state=invalid action=drop comment="wavly-input-drop-invalid"
  add chain=input in-interface=$lanif protocol=tcp dst-port=22,80,443 action=accept comment="wavly-input-lan-mgmt"  # winbox/www from LAN only — restrict further if desired
  add chain=input in-interface=$lanif action=accept comment="wavly-input-lan-all"
  add chain=input action=drop comment="wavly-input-drop-rest"     # WAN hits nothing: CGNAT means nothing arrives anyway
  add chain=forward connection-state=invalid action=drop comment="wavly-forward-drop-invalid"
  add chain=forward connection-state=established,related action=accept comment="wavly-forward-allow-established"
  add chain=forward src-address=$hotspotNet connection-limit=40,32 action=drop comment="wavly-forward-connlimit"   # basic abuse protection
}

# ─── 4. Hotspot user profiles (speed plans) ───────────────────────────────────
# rate-limit is "<client-upload>/<client-download>" (rx/tx). Verify with a speedtest after import.
# shared-users = max simultaneous devices per account (snapshot of plan at purchase; keep aligned).
/ip hotspot user profile
:do { add name="wavly-basic-3m" rate-limit="1024k/3M" shared-users=2 address-pool=$poolName keepalive-timeout=5m } on-error={ set [find name="wavly-basic-3m"] rate-limit="1024k/3M" shared-users=2 }
:do { add name="wavly-std-5m"  rate-limit="1M/5M"   shared-users=3 address-pool=$poolName keepalive-timeout=5m } on-error={ set [find name="wavly-std-5m"]  rate-limit="1M/5M"   shared-users=3 }
:do { add name="wavly-prem-10m" rate-limit="2M/10M" shared-users=4 address-pool=$poolName keepalive-timeout=5m } on-error={ set [find name="wavly-prem-10m"] rate-limit="2M/10M" shared-users=4 }
# Local users only get created by the portal sync — this is just the fallback profile.
:do { add name="wavly-default"  rate-limit="512k/1M" shared-users=1  address-pool=$poolName keepalive-timeout=5m } on-error={ set [find name="wavly-default"] rate-limit="512k/1M" }

# ─── 5. Hotspot server profile + server ───────────────────────────────────────
/ip hotspot profile
:if ([:len [find name=$hsServerProf]] = 0) do={
  add name=$hsServerProf html-directory=hotspot dns-name=$portalHost
} else={
  set [find name=$hsServerProf] html-directory=hotspot dns-name=$portalHost
}
# login-by differs by RouterOS build; set whichever exists. http-chap avoids plaintext creds in cleartext.
:do { /ip hotspot profile set [find name=$hsServerProf] login-by=http-chap,cookie } on-error={ :put "login-by not on server profile on this build — see user profile below" }
:do { /ip hotspot user profile set [find name="wavly-std-5m"] login-by=http-chap,cookie } on-error={ :put "login-by not on user profile on this build — non-fatal" }

/ip hotspot
:if ([:len [find name=$hsServer]] = 0) do={
  add name=$hsServer interface=$lanif address-pool=$poolName profile=$hsServerProf addresses-per-mac=2 disabled=no
} else={
  set [find name=$hsServer] interface=$lanif address-pool=$poolName profile=$hsServerProf addresses-per-mac=2 disabled=no
}

# ─── 6. Walled garden (pre-auth access): portal + payment + SMS infrastructure ─
# Domain matching resolves client DNS via the router — no IPs to babysit.
:local portalHosts { $portalHost; "*.vercel.app" }
:local paystack { "paystack.co"; "*.paystack.co"; "paystack.com"; "*.paystack.com"; "checkout.paystack.com"; "api.paystack.co"; "inline.paystack.com"; "js.paystack.co"; "cdn.paystack.co" }
:local smsApis  { "arkesel.com"; "*.arkesel.com" }   # payloads originate portal-side; harmless to allow
:foreach h in=($portalHosts,$paystack,$smsApis) do={
  :local exists [/ip hotspot walled-garden find dst-host=$h]
  :if ([:len $exists] = 0) do={ /ip hotspot walled-garden add action=allow protocol=tcp dst-host=$h comment="wavly-wg" }
}
# OPTIONAL: block abusive categories pre/post-auth (examples — keep tight)
# /ip hotspot walled-garden add action=deny dst-host="ads.doubleclick.net" comment="wavly-block"

# ─── 7. RADIUS client — present but DISABLED (Phase 4 / Option A path) ───────
# To enable: deploy FreeRADIUS (docs/freeradius.md), set the address/secret, then set disabled=no.
/radius
:if ([:len [find comment="wavly-radius"]] = 0) do={
  add service=hotspot address=192.168.88.10 secret="PASTE_RADIUS_SECRET" timeout=3s disabled=yes comment="wavly-radius"
}

# ─── 8. Housekeeping: comments so support can find things ─────────────────────
:put "Wavly WiFi base config imported. Next: import sync-scheduler.rsc, upload login.html to the hotspot directory, then run docs/mikrotik.md verification."
