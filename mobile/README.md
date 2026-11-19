# Timetable Studio — Mobile (Expo / React Native)

Cross-platform mobile app for the Timetable Management System. Same backend,
same Neon Auth, same Neon Realtime live queries as the web app — native UI in
React Native (Expo SDK 58, TypeScript).

## Screens

| Screen | Who | What |
| --- | --- | --- |
| Login | everyone | Email/password sign-in + sign-up (Neon Auth, managed Better Auth) |
| Timetables | everyone | Browse published sections; faculty & staff can also browse by teacher or room. Live updates over Neon Realtime. |
| My Classes | faculty | Own weekly schedule + tap-to-raise reschedule/cancel requests |
| My requests | faculty | Status + admin decision notes for raised requests |
| Approvals | admin | Approve & apply / reject pending change requests |
| Profile | everyone | Role, faculty link, pending badge (admins), light/dark/system theme, sign out |

The admin Designer grid, Master Data CRUD, and Excel Import remain web-only by
design (they are desktop-shaped workflows).

## How it talks to the backend

- `GET /api/config` (public) → `{ authBaseUrl, realtimeUrl }` so the app never
  hardcodes branch URLs.
- Auth: Neon Auth (Managed Better Auth) REST endpoints — `POST /sign-in/email`,
  `GET /get-session`, `GET /token`, `POST /sign-out`. Neon Auth authorizes
  those endpoints with its **signed session cookie** (its bearer plugin is not
  exposed), so the client replays the `Set-Cookie` issued at sign-in: the
  cookie lives in `expo-secure-store`, and `GET /token` mints the short-lived
  (~15 min) EdDSA JWT that is sent to the API as `Authorization: Bearer` and
  re-minted automatically before expiry (see `src/services/api.ts`).
- Auth/realtime go through the backend's transparent proxies (`/neon-auth/*`,
  `/neon-rt/*`) — advertised by `GET /api/config`. Emulator NATs and VPN'd
  networks often cannot reach the Neon endpoints directly; the API host is
  always reachable. The proxy also keeps handshake headers clean (Neon's edge
  403s non-minimal WS upgrades). From any normal network the app would reach
  Neon directly just as well.
- Role/faculty resolution: `GET /api/me` (same shape the web app consumes).
- Realtime: sealed live queries via `POST /api/realtime/:viewType/:resourceId`,
  subscribed with the `react-native` build of `@neon/realtime` over the
  `/neon-rt` tunnel, with the same 10s-before-expiry renewal loop as the web
  app. Falls back to the REST snapshot if WebSockets are blocked.
- Origin: native fetch sends no `Origin`, so the auth client pins
  `http://localhost:5173` (Neon pre-approves localhost). For production either
  keep the proxy (recommended — no Neon domain registration needed) or register
  your origin with `neon neon-auth domain add`.

## Configuration

`mobile/.env`:

```
EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:5000/api   # Android emulator → host
```

- Real device on Wi-Fi: use your machine's LAN IP, e.g. `http://192.168.1.20:5000/api`.
- Production: point it at the deployed API (e.g. `https://<render-app>.onrender.com/api`).
- `EXPO_PUBLIC_AUTH_ORIGIN` (optional) overrides the Origin sent to Neon Auth.

`EXPO_PUBLIC_*` values are inlined into the JS bundle when Metro bundles —
restart Metro after changing them.

## Smoke-test accounts

Created during development (see `backend/scripts/mobile-smoke-*.js`; cleanup
SQL is printed by each script):

- `mobile.test@ttstudio.dev` / `TestPass123!` — faculty-linked viewer (own
  schedule, change requests)
- `mobile.admin@ttstudio.dev` / `AdminPass123!` — admin (Approvals tab)

## Run on Android

```bash
cd mobile
npm install
npx expo run:android          # prebuild + gradle + install on emulator/device
```

Or build only: `npx expo prebuild --platform android` then
`cd android && ./gradlew assembleDebug` → APK at
`android/app/build/outputs/apk/debug/app-debug.apk`.

## Run on iOS (future)

The iOS Simulator requires macOS — it cannot run on this Windows machine
(`npx expo prebuild --platform ios` also refuses on Windows). Three real paths,
fastest first:

**1. Expo Go on a real iPhone — works today, no Mac needed.**
All native modules used (expo-secure-store, expo-image, expo-status-bar) ship
inside Expo Go. From this PC the network is already open (firewall allows
Node.js inbound; Metro listens on all interfaces):

1. Start Metro: `cd mobile && npx expo start`
2. iPhone on the **same Wi-Fi** → install **Expo Go** from the App Store →
   open `exp://192.168.0.198:8081` (or scan the QR Metro prints interactively).
3. The app picks the right API host automatically — the emulator loopback
   (`10.0.2.2`) fails fast and the LAN address (`EXPO_PUBLIC_LAN_API_BASE_URL`
   in `.env`) answers.

**2. EAS Build — cloud Mac builds a real iOS binary.** `eas.json` is ready:

```bash
npm i -g eas-cli
eas login                      # free Expo account
eas build --platform ios -p development   # dev build for your devices
eas build --platform ios -p preview       # simulator build (.app for any Mac)
eas build --platform ios -p production    # App Store / TestFlight (needs Apple Developer $99/yr)
```

**3. Any Mac** — `cd mobile && npm install && npx expo run:ios` (generates the
`ios/` project there — Windows cannot).

Bundle id: `com.shivendra3030.timetablestudio` (`app.json`).

## Project layout

```
mobile/
  App.tsx                     # providers + auth gate + navigation container
  .env                        # EXPO_PUBLIC_API_BASE_URL
  src/
    config.ts                 # API base + /api/config bootstrap
    theme.ts                  # light/dark palettes, spacing, days
    services/
      auth.ts                 # native Neon Auth REST client (SecureStore)
      api.ts                  # axios + JWT bearer interceptor w/ re-mint
      realtime.ts             # live-query subscribe hook + renewal loop
    context/
      SessionContext.tsx      # session restore, /me, sign in/out
      ThemeContext.tsx        # system/light/dark persistence
    components/
      ui.tsx                  # Card/Chip/Button/Input/Screen primitives
      Toast.tsx               # toast host
      TimetableGrid.tsx       # day-grouped weekly list (phone-friendly)
    screens/
      LoginScreen.tsx
      BrowseScreen.tsx        # sections/faculty/rooms + live timetable view
      MyTimetableScreen.tsx   # faculty schedule + request sheet
      MyRequestsScreen.tsx    # faculty request status list
      AdminRequestsScreen.tsx # admin approve/reject
      ProfileScreen.tsx
```
