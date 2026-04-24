<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/9bb29aa9-a593-488e-9733-57c7d9ebd479

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Create `.env.local` from `.env.example`
3. Fill in your Firebase web app values and `GEMINI_API_KEY` in `.env.local`
   Use `VITE_FIREBASE_FIRESTORE_DATABASE_ID=(default)` unless you intentionally want a separate billed Firestore database.
4. Run the app:
   `npm run dev`

## Primary Deploy Target

This app's primary live URL is:

`https://dinkly-715753958407.us-west1.run.app/`

Use this command for normal production deploys:

`npm run deploy`

That script deploys to the existing `dinkly` Cloud Run service in:
- project: `recruit-pro`
- region: `us-west1`
- service URL: `https://dinkly-715753958407.us-west1.run.app/`

It packages the repo source, uploads a build archive to the AI Studio bucket, and rolls the existing Cloud Run service forward.

## Deploy To Firebase Hosting

This project is now configured for Firebase Hosting with SPA rewrites.

Files added for Hosting:
- `firebase.json`
- `.firebaserc`

Project target:
- Firebase project: `recruit-pro`

### One-time setup

1. Install the Firebase CLI if you do not already have it:
   `npm install -g firebase-tools`
2. Log in from this folder so Firebase stores the local auth state in `dinkly/.config/`:
   `XDG_CONFIG_HOME=.config FIREBASE_TOOLS_DISABLE_UPDATE_CHECK=1 firebase login`
3. From this `dinkly/` folder, verify the active project:
   `XDG_CONFIG_HOME=.config FIREBASE_TOOLS_DISABLE_UPDATE_CHECK=1 firebase use`

### Deploy

Only use this if you intentionally want the secondary Firebase Hosting copy at `https://recruit-pro.web.app`.

Run:

`npm run hosting:deploy`

That command will:
- build the Vite app into `dist/`
- deploy the built site to Firebase Hosting

### Preview locally

Run:

`npm run hosting:emulate`

### Notes

- Client-side routes are rewritten to `/index.html`, which is the standard Firebase Hosting setup for React/Vite single-page apps.
- Firebase CLI auth is kept in `dinkly/.config/`, which is ignored by git.
- `npm run deploy` is the default and correct production deploy path for the `run.app` domain.
- If you want to deploy Firestore rules as part of the same flow, we can add that next.
- The live Firebase config file is intentionally not committed; use `.env.local` for real values.
- This repo is configured to target the default Firestore database for lower-cost operation unless you deliberately override it in `.env.local`.
