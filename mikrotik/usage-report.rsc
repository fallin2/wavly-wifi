# Wavly WiFi — usage reporter (RouterOS v7)
# Reads active hotspot sessions and POSTs one line per session to the portal:
#   <mac>,<username>,<bytes_in>,<bytes_out>,<uptime_s>
# The portal stores DELTAS (it keeps the last router counter per user).
# Import manually to test; schedule created at the bottom.

:local portalUrl    "https://portal.REPLACE-ME.example/api/router/usage"
:local routerKey    "PASTE_ROUTER_SYNC_SECRET"
:local nodeName     "mikrotik-nkawie-1"

:local body ""
:foreach s in=[/ip hotspot active find] do={
  :do {
    :local u  [/ip hotspot active get $s user]
    :local m  [/ip hotspot active get $s mac-address]
    :local bi [/ip hotspot active get $s bytes-in]
    :local bo [/ip hotspot active get $s bytes-out]
    :local up [/ip hotspot active get $s uptime]
    :set body ($body . $m . "," . $u . "," . $bi . "," . $bo . "," . $up . "\n")
  } on-error={
    :put "wavly-usage: session row skipped (read error)"
  }
}

:if ([:len $body] = 0) do={ :put "wavly-usage: no active sessions" ; :error "no-sessions" }

:do {
  /tool fetch url=$portalUrl http-method=post http-data=$body output=none check-certificate=yes-and-verify \
    http-header-field=("X-Router-Key: " . $routerKey . ",X-Router-Name: " . $nodeName . ",Content-Type: text/plain")
  :put "wavly-usage: usage report sent"
} on-error={
  :put "wavly-usage: POST failed — will retry next interval"
}

/system scheduler
:if ([:len [find name="wavly-usage"]] = 0) do={
  add name="wavly-usage" interval=5m on-event="/import file-name=usage-report.rsc" start-time=startup \
      comment="Wavly usage report to portal"
}
