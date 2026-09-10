This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
# ciiya

## Quality checks

Run the same checks used by CI before a release:

```bash
npm run check
npm run test:e2e
```

The public and anonymous-route tests run in every checkout. Configure
`E2E_USER_EMAIL` and `E2E_USER_PASSWORD` with a dedicated test account to run
the create-album, upload, share and cleanup flow. `E2E_SHARE_TOKEN` enables the
public gallery reaction tests.

GitHub Actions also needs the Supabase and worker secrets listed in
`.env.example`. Never use a personal account for E2E credentials.
`npm run check:env` prevents CI from passing when code starts using an
environment variable that has not been documented in `.env.example`.

## Monitoring

Next.js server rendering failures and browser runtime errors are written as
structured `ciiya-monitor` events to the deployment logs. Set an HTTPS
`ERROR_MONITORING_WEBHOOK_URL` to forward sanitized server error events to an
external incident system. The existing `/api/health?monitor=1` endpoint is the
status-code probe for an uptime monitor (200 healthy, 503 degraded).
