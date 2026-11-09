#!/usr/bin/env bash
# Opens the family board full screen on the TV once the calendar server is up.
exec 9>/tmp/family-calendar-kiosk.lock
flock -n 9 || exit 0   # already running (several autostart methods may call this)
for i in $(seq 1 120); do
  curl -fs http://localhost:3000/api/health >/dev/null && break
  sleep 2
done
CHROME="$(command -v chromium || command -v chromium-browser)"
# Clear the "Chromium didn't shut down correctly" bubble after power cuts.
PREFS="$HOME/.config/chromium/Default/Preferences"
[ -f "$PREFS" ] && sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$PREFS"
exec "$CHROME" --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
  --check-for-update-interval=31536000 --password-store=basic --autoplay-policy=no-user-gesture-required \
  http://localhost:3000/tv
