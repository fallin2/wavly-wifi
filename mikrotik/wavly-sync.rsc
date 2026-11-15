# Wavly WiFi — outbound sync worker (RouterOS v7)
# Config lives in the first lines. Import manually to test:
#   /import file-name=wavly-sync.rsc
# The scheduler created by sync-scheduler.rsc runs this file on an interval.
# Wire format: mikrotik/sync-format.md (Wire Format v1). No inbound connectivity is used or required.

:local portalUrl    "https://portal.REPLACE-ME.example/api/router/sync"
:local routerKey    "PASTE_ROUTER_SYNC_SECRET"
:local nodeName     "mikrotik-nkawie-1"
:local selftest     "no"    # "yes" = fetch + parse + log, apply NOTHING

:local resultFile   "wavly-sync-last.txt"

# ─── fetch ────────────────────────────────────────────────────────────────────
:local resp ""
:local httpStatus "0"
:do {
  :set resp [/tool fetch url=$portalUrl output=user as-value check-certificate=yes-and-verify \
              http-header-field=("X-Router-Key: " . $routerKey . ",X-Router-Name: " . $nodeName)]
  :set httpStatus ($resp->"http-status")
  :set resp ($resp->"data")
} on-error={
  :put "wavly-sync: fetch failed (link down or TLS issue) — keeping last known state"
  :error "fetch-failed"
}
:if ($httpStatus != "200") do={
  :put ("wavly-sync: HTTP " . $httpStatus . " — keeping last known state")
  :error ("http-" . $httpStatus)
}
:if ([:len $resp] = 0) do={ :put "wavly-sync: empty response — nothing to do" ; :error "done" }

# ─── parse: 6-token records, comma-separated, "-" = empty ─────────────────────
:local t [:toarray $resp]
:local n [:len $t]
:if (($n % 6) != 0) do={
  :put ("wavly-sync: token count " . $n . " not a multiple of 6 — payload rejected")
  :error "bad-payload"
}
:local applied 0
:local failed 0

:for i from=0 to=($n - 1) step=6 do={
  :local op  ($t->$i)
  :local f1  ($t->($i+1))
  :local f2  ($t->($i+2))
  :local f3  ($t->($i+3))
  :local f4  ($t->($i+4))
  :local f5  ($t->($i+5))
  :local u   $f1

  :if ($selftest = "yes") do={
    :put ("selftest would apply: op=" . $op . " user=" . $u . " f2=" . $f2 . " f3=" . $f3 . " f4=" . $f4 . " f5=" . $f5)
  } else={
    :if ($op = "1") do={
      # upsert hotspot user
      :local prof $f3
      :local mac  $f5
      :local limitMin [:tonum $f4]
      :local exists [/ip hotspot user find name=$u]
      :if ([:len $exists] = 0) do={
        :if ($mac = "-") do={
          /ip hotspot user add name=$u password=$f2 profile=$prof comment="wavly-sync"
        } else={
          /ip hotspot user add name=$u password=$f2 profile=$prof mac-address=$mac comment="wavly-sync"
        }
      } else={
        :if ($mac = "-") do={
          /ip hotspot user set [find name=$u] password=$f2 profile=$prof mac-address="" comment="wavly-sync"
        } else={
          /ip hotspot user set [find name=$u] password=$f2 profile=$prof mac-address=$mac comment="wavly-sync"
        }
      }
      # limit-uptime: 0 = no limit; MikroTik time format for minutes: "<m>m"
      :if ($limitMin > 0) do={
        /ip hotspot user set [find name=$u] limit-uptime=($limitMin . "m")
      } else={
        /ip hotspot user set [find name=$u] limit-uptime="none"
      }
      :set applied ($applied + 1)
    } else={ :if ($op = "2") do={
      /ip hotspot user enable [find name=$u]
      :set applied ($applied + 1)
    } else={ :if ($op = "3") do={
      /ip hotspot user disable [find name=$u]
      :set applied ($applied + 1)
    } else={ :if ($op = "4") do={
      :foreach s in=[/ip hotspot active find user=$u] do={ /ip hotspot active remove $s }
      :set applied ($applied + 1)
    } else={
      :put ("wavly-sync: unknown op " . $op . " — skipped")
      :set failed ($failed + 1)
    } } } }
  }
}

# ─── journal (readable by support: /file print file-name=wavly-sync-last.txt) ─
:do {
  :local line ([/system clock get time] . " " . [/system clock get date] . " applied=" . $applied . " failed=" . $failed . " http=" . $httpStatus)
  :local existing [/file find name=$resultFile]
  :if ([:len $existing] = 0) do={
    :put $line
  } else={
    /file set $resultFile contents=$line
  }
} on-error={ :put "wavly-sync: journal write failed (non-fatal)" }
:put ("wavly-sync done: applied=" . $applied . " failed=" . $failed)
