# Geiger Family Calendar

A family calendar for the kitchen TV that anyone in the house can update from a phone or computer.

- **Edit view** (`/`): events, chores, dinner plan, grocery list, school days, countdowns, a family note, and settings.
- **TV board** (`/tv`): big clock and weather, today's events, school items, dinner and chores, the next six days, countdowns and the grocery list. Dark, glanceable and auto-updating.
- **Apple Calendar**: add public iCloud calendar links in Settings and their events show up automatically (read-only).
- **Weather**: from Open-Meteo (free, no key), set to Wolf Lake, IN by default. Change it in Settings.
- **One family passcode**: no accounts. Each device enters the passcode once and stays signed in.

It costs nothing to run: a free Render web service plus a free Neon Postgres database.

## Set it up on Render (free)

1. **Make the free database.** Sign up at [neon.tech](https://neon.tech) (free plan), create a project, and copy its connection string (it starts with `postgresql://`).
2. **Make the web service.** In the [Render dashboard](https://dashboard.render.com), choose **New → Web Service**, pick this GitHub repo, and use:
   - Runtime: Node · Build command: `npm install` · Start command: `npm start`
   - Instance type: **Free**
3. **Add environment variables** on that service:
   - `FAMILY_PASSCODE`: the passcode everyone will type once
   - `DATABASE_URL`: the Neon connection string
   - `FAMILY_TZ`: `America/Indiana/Indianapolis` (already the default)
4. Deploy. Open the `onrender.com` address on your phone, enter the passcode, and you're in. Every push to `main` redeploys automatically.

On the TV, open the same address with `/tv` on the end, enter the passcode once, and press **Full screen**.

**About the free plan:** Render's free services go to sleep after about 15 minutes with no visitors and take up to a minute to wake. The TV board checks in every few seconds, so while the TV is on the app stays awake. Render's own free Postgres expires after 30 days, which is why the data lives in Neon instead.

## Or run it at home on a Raspberry Pi (also free)

With no `DATABASE_URL`, the app saves everything to `data/family-data.json`.

```bash
sudo apt install -y nodejs npm   # Node 20 or newer
git clone <this repo> && cd geiger-family-calendar
npm install
FAMILY_PASSCODE=yourcode npm start   # then open http://<pi-name>.local:3000
```

Phones on your home Wi-Fi can edit it at `http://<pi-name>.local:3000`.

## Getting the Apple Calendar link

- **iPhone:** Calendar → **Calendars** → ⓘ next to the calendar → turn on **Public Calendar** → **Share Link…** → copy.
- **Mac:** Calendar → right-click the calendar → **Share Calendar…** → tick **Public Calendar** → copy the link.

Paste it under **Settings → Apple Calendar** and choose whose color it uses. Anyone with that link can see that calendar, so keep it to this app.

## Local development

```bash
npm install
FAMILY_PASSCODE=test npm start
```
