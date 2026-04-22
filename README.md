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
4. Run the app:
   `npm run dev`

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
- If you want to deploy Firestore rules as part of the same flow, we can add that next.
- The live Firebase config file is intentionally not committed; use `.env.local` for real values.
