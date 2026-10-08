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

## How it talks to Ciiya

- Photographers sign in with Supabase Auth. The session is stored in the
  device keychain (`src/lib/secure-storage.ts`).
- Data is read as the signed-in user under row level security, with the public
  anon key only. Never add the service role key or a worker secret here.
