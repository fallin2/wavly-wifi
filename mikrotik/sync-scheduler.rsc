# Wavly WiFi — install the sync schedule (run AFTER setup.rsc and wavly-sync.rsc are uploaded)
# The scheduler re-imports wavly-sync.rsc every interval — no long-lived /system script needed,
# and script updates are a file re-upload away.

/system scheduler
:local exists [find name="wavly-sync"]
:if ([:len $exists] = 0) do={
  add name="wavly-sync" interval=45s on-event="/import file-name=wavly-sync.rsc" start-time=startup \
      comment="Wavly outbound sync (pulls pending ops from portal)"
} else={
  set $exists interval=45s on-event="/import file-name=wavly-sync.rsc" comment="Wavly outbound sync"
}
:put "Scheduler installed. Test now with: /import file-name=wavly-sync.rsc"
