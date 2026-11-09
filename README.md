# Family Calendar

A family calendar for the kitchen TV that anyone in the house can update from a phone or computer. It runs on a Raspberry Pi plugged into the TV and costs nothing to run.

- **TV board** (`/tv`): big clock and weather, today's events, school items, dinner and chores, the next six days, countdowns, the family note and the grocery list. Dark, glanceable, and it updates by itself.
- **Edit view** (`/`): events, chores, dinner plan, grocery list, school days, countdowns, the family note and settings. Works on phones and computers.
- **Apple Calendar**: add public iCloud calendar links in Settings and their events appear automatically (read-only).
- **Weather**: from Open-Meteo (free, no key).
- **One family passcode**: no accounts. Each phone enters it once and stays signed in. The TV itself never asks.

## What you need

- A Raspberry Pi 4 or 5 kit (power supply, case, microSD card, micro-HDMI to HDMI cable)
- The TV, a free HDMI port, and your Wi-Fi

## Set up the Pi

1. **Prepare the memory card.** On a computer, install [Raspberry Pi Imager](https://www.raspberrypi.com/software/). Choose your Pi model, **Raspberry Pi OS (64-bit)** (the regular one, with desktop), and your microSD card. When it asks about settings, choose **Edit settings** and fill in a username and password, your Wi-Fi name and password, and your time zone. Write the card.
2. **Start the Pi.** Put the card in the Pi, plug it into the TV with HDMI, then plug in power. Plug a USB keyboard and mouse in for setup (you can unplug them afterwards). Wait for the desktop.
3. **Run the installer.** Open **Terminal** (the black icon at the top) and paste the install command you were given. It installs everything, asks you to choose the family passcode, and tells you when it's done.
4. **Restart.** Type `sudo reboot`. From now on the Pi boots straight into the calendar, full screen.

On phones and computers at home, open **http://familycal.local:3000** and enter the passcode. Add it to your home screen (Share → Add to Home Screen on iPhone) so it opens like an app.

## Apple Calendar link

- **iPhone:** Calendar → **Calendars** → ⓘ next to the calendar → turn on **Public Calendar** → **Share Link…** → copy.
- **Mac:** Calendar → right-click the calendar → **Share Calendar…** → tick **Public Calendar** → copy the link.

Paste it under **Settings → Apple Calendar** and choose whose color it uses. Anyone with that link can see that calendar, so keep it to this app.

## Good to know

- **Updates:** the Pi checks for a new version every night at 3:30am and installs it. To update right away: `~/family-calendar/deploy/update.sh`.
- **Your data** lives on the Pi in `~/family-calendar/data/`. Copy that folder somewhere safe now and then if you want a backup.
- **Settings** (passcode, family names, town) are in `/etc/family-calendar.env`. After changing them, run `sudo systemctl restart family-calendar`.
- **Editing away from home:** out of the box it works on your home Wi-Fi only. To edit from anywhere for free, install [Tailscale](https://tailscale.com) on the Pi and on your phones.
- **Something's off?** `sudo systemctl status family-calendar` shows whether the server is running, and `journalctl -u family-calendar -n 50` shows its recent log.

## Running it elsewhere

The server also runs anywhere Node 18+ runs. Set `FAMILY_PASSCODE`, and optionally `DATABASE_URL` (Postgres, for example a free Neon database) instead of the local data file. `render.yaml` describes a free Render web service.

```bash
npm install
FAMILY_PASSCODE=test npm start   # http://localhost:3000
```
