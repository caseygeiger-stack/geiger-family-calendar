#!/usr/bin/env bash
# Sets up a Raspberry Pi (Raspberry Pi OS with desktop) as the family calendar:
# runs the calendar server, opens the TV board full screen at boot, keeps the screen on,
# and updates itself nightly.
#
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/deploy/install-pi.sh | bash -s -- \
#     --members "Name1,Name2" --town "Town, ST" --lat 40.0 --lon -85.0
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/caseygeiger-stack/geiger-family-calendar.git}"
APP_DIR="$HOME/family-calendar"
MEMBERS=""; TOWN=""; LAT=""; LON=""; NEW_HOSTNAME="familycal"; TZ_NAME="America/Indiana/Indianapolis"

while [ $# -gt 0 ]; do
  case "$1" in
    --members) MEMBERS="$2"; shift 2 ;;
    --town) TOWN="$2"; shift 2 ;;
    --lat) LAT="$2"; shift 2 ;;
    --lon) LON="$2"; shift 2 ;;
    --hostname) NEW_HOSTNAME="$2"; shift 2 ;;
    --tz) TZ_NAME="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

say() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
if [ "$(id -u)" -eq 0 ]; then echo "Run this as your normal Pi user, not with sudo."; exit 1; fi

say "Installing what the calendar needs (a few minutes)"
sudo apt-get update -y
sudo apt-get install -y git nodejs npm curl
if ! command -v chromium >/dev/null && ! command -v chromium-browser >/dev/null; then
  sudo apt-get install -y chromium || sudo apt-get install -y chromium-browser
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then echo "Node.js 18 or newer is needed (found $(node -v)). Update Raspberry Pi OS and try again."; exit 1; fi

say "Downloading the calendar"
if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" pull --ff-only -q; else git clone -q "$REPO_URL" "$APP_DIR"; fi
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund -q
chmod +x deploy/*.sh

ENV_FILE=/etc/family-calendar.env
if sudo test -f "$ENV_FILE"; then
  say "Keeping your existing settings in $ENV_FILE"
else
  say "Choose the family passcode (everyone types it once on their phone)"
  while true; do
    read -rsp "Passcode: " P1 </dev/tty; echo
    read -rsp "Same passcode again: " P2 </dev/tty; echo
    if [ -n "$P1" ] && [ "$P1" = "$P2" ]; then break; fi
    echo "Those didn't match (or were empty). Try again."
  done
  sudo install -m 600 /dev/null "$ENV_FILE"
  {
    echo "FAMILY_PASSCODE=$P1"
    echo "FAMILY_TZ=$TZ_NAME"
    echo "FAMILY_MEMBERS=$MEMBERS"
    echo "FAMILY_TOWN=$TOWN"
    echo "FAMILY_LAT=$LAT"
    echo "FAMILY_LON=$LON"
    echo "TRUST_LOCALHOST=1"
    echo "PORT=3000"
    echo "DATA_FILE=$APP_DIR/data/family-data.json"
  } | sudo tee "$ENV_FILE" >/dev/null
fi

say "Starting the calendar server (and at every boot)"
sudo tee /etc/systemd/system/family-calendar.service >/dev/null <<EOF
[Unit]
Description=Family calendar
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now family-calendar
echo "$USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart family-calendar" | sudo tee /etc/sudoers.d/family-calendar >/dev/null
sudo chmod 440 /etc/sudoers.d/family-calendar

say "Opening the calendar full screen when the Pi starts"
KIOSK="$APP_DIR/deploy/kiosk.sh"
# Newer Raspberry Pi OS (labwc)
mkdir -p "$HOME/.config/labwc"
grep -qs "$KIOSK" "$HOME/.config/labwc/autostart" || echo "$KIOSK &" >> "$HOME/.config/labwc/autostart"
# Earlier Bookworm (wayfire)
if [ -f "$HOME/.config/wayfire.ini" ] && ! grep -qs "$KIOSK" "$HOME/.config/wayfire.ini"; then
  if grep -q '^\[autostart\]' "$HOME/.config/wayfire.ini"; then
    sed -i "/^\[autostart\]/a familycal = $KIOSK" "$HOME/.config/wayfire.ini"
  else
    printf '\n[autostart]\nfamilycal = %s\n' "$KIOSK" >> "$HOME/.config/wayfire.ini"
  fi
fi
# Older X11 desktop and anything that honors XDG autostart
mkdir -p "$HOME/.config/lxsession/LXDE-pi" "$HOME/.config/autostart"
grep -qs "$KIOSK" "$HOME/.config/lxsession/LXDE-pi/autostart" || echo "@$KIOSK" >> "$HOME/.config/lxsession/LXDE-pi/autostart"
cat > "$HOME/.config/autostart/family-calendar.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Family calendar
Exec=$KIOSK
EOF

if command -v raspi-config >/dev/null; then
  say "Keeping the screen on and naming this Pi '$NEW_HOSTNAME'"
  sudo raspi-config nonint do_blanking 1 || true
  sudo raspi-config nonint do_boot_behaviour B4 || true   # boot to desktop, signed in automatically
  [ -n "$NEW_HOSTNAME" ] && sudo raspi-config nonint do_hostname "$NEW_HOSTNAME" || true
fi

say "Checking for updates every night at 3:30am"
( crontab -l 2>/dev/null | grep -v 'family-calendar/deploy/update.sh'; echo "30 3 * * * $APP_DIR/deploy/update.sh >> $APP_DIR/data/update.log 2>&1" ) | crontab -
mkdir -p "$APP_DIR/data"

for i in $(seq 1 15); do curl -fs http://localhost:3000/api/health >/dev/null && break; sleep 1; done
IP="$(hostname -I | awk '{print $1}')"
say "All set!"
cat <<EOF
Restart the Pi now:   sudo reboot
After it restarts, the TV shows the family calendar on its own.

To edit from a phone or computer on your home Wi-Fi, open:
    http://$NEW_HOSTNAME.local:3000      (or http://$IP:3000)
and type the family passcode once.
EOF
