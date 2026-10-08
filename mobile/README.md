# Ciiya mobile

The Ciiya app for iOS (Android to follow), built with Expo / React Native.
It lives beside the web app but has its own dependencies, lint and typecheck;
the web app's `tsconfig.json` and ESLint config exclude this folder.

## Run

```bash
cp .env.example .env.local   # fill in the two public Supabase values
npm install
npm run ios                  # opens the iOS Simulator (Expo Go)
```

## Check

```bash
npm run typecheck
npm run lint
```

## Demo mode

`EXPO_PUBLIC_DEMO=1 npx expo start` runs the app on built-in sample data, with
no sign-in and no network writes. It only works in development builds.

## How it talks to Ciiya

- Photographers sign in with Supabase Auth (email and password, or Google). The
  session is stored in the device keychain (`src/lib/secure-storage.ts`).
- Albums and photos are read from the web app's `/api/mobile/*` routes, and
  changes go through the same album routes the website uses. Every request
  carries the signed-in user's access token as `Authorization: Bearer`, so the
  server applies the same ownership rules as on the web.
- `EXPO_PUBLIC_SITE_URL` picks the server (default `https://www.ciiya.app`).
  Point it at a local `npm run dev` to test against unreleased API changes.
- Only the public anon key ships in the app. Never add the service role key or
  a worker secret here.

## Google sign-in setup

Add the app's redirect URLs to Supabase → Authentication → URL Configuration:
`ciiya://**` for builds, plus `exp://**` while developing in Expo Go.
