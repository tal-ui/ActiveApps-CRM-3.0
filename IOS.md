# ActiveApps CRM — iOS

The CRM ships as an iOS app two ways. Both reuse the live web app 1:1 — same
login, same Supabase data, all features (pipeline, timer, ⌘K palette,
maintenance console, …), light/dark theme included.

## 1. Install today — Home Screen app (PWA, no Mac needed)

1. On the iPhone, open **https://activeapps-crm-v3.vercel.app** in **Safari**.
2. Tap **Share → Add to Home Screen → Add**.

The CRM installs with the ActiveApps icon and launches full-screen
(standalone, no browser chrome, notch-safe). Updates are automatic — every
production deploy is live on next launch.

## 2. Native app — Capacitor Xcode project (App Store ready)

The `ios/` directory is a complete Capacitor 8 Xcode project
(`appId com.activeapps.crm`, Swift Package Manager — no CocoaPods required)
that wraps the built web app in a native WKWebView shell. It is submission-
ready out of the box:

- **Brand assets baked in** — opaque 1024×1024 marketing icon and navy
  splash screens live in `ios/App/App/Assets.xcassets` (regenerate from
  `public/aa-logo.png` if the brand changes).
- **Native splash** — brand-navy launch screen, auto-hides after 1.5 s
  (`capacitor.config.ts → plugins.SplashScreen`).
- **Status bar follows the theme** — light text in dark mode, dark text in
  light mode (`src/lib/theme.ts` syncs `@capacitor/status-bar` on toggle and
  on launch; inert in browsers).
- **Store compliance pre-answered** — `Info.plist` carries photo-library and
  camera purpose strings (the Attachments feature opens the photo picker) and
  `ITSAppUsesNonExemptEncryption = false`, so uploads skip the export-
  compliance questionnaire. Marketing version is 3.2.0.

### Build & run (requires macOS + Xcode 15+)

First time on a Mac — run these in Terminal, in order:

```bash
# 0. Node.js v20+ is required — if this prints "command not found" or v18
#    or older, install the LTS from https://nodejs.org (or: brew install node)
node -v

# 1. Get the project and enter its folder (everything below runs from there)
git clone https://github.com/tal-ui/ActiveApps-CRM-3.0.git
cd ActiveApps-CRM-3.0

# 2. Install dependencies (includes the Capacitor CLI)
npm install
```

Then, for every build:

```bash
npm run ios:sync       # builds the web app + syncs it into ios/
npm run ios:open       # opens ios/App in Xcode
```

In Xcode: select the **App** target → *Signing & Capabilities* → choose your
Apple Developer team (automatic signing, bundle id `com.activeapps.crm`) →
pick a simulator or plugged-in iPhone → **Run**.

### Troubleshooting

**`npm error could not determine executable to run`** — npx couldn't find the
Capacitor CLI. One of three causes:

1. **Wrong folder** — the commands must run from the cloned repo root. Check
   with `ls package.json`; if it says "No such file", `cd` into the
   `ActiveApps-CRM-3.0` folder you cloned (or clone it first, step 1 above).
2. **Dependencies not installed** — run `npm install` in that folder and wait
   for it to finish without errors.
3. **Node too old** — `node -v` must show v20+. Upgrade via nodejs.org or
   `brew install node`, then delete `node_modules` and re-run `npm install`.

The `npm run ios:*` scripts above check for the CLI and print a clear message
instead of the cryptic npx error. Explicit fallback if you ever need it:
`npx @capacitor/cli@8 sync ios` / `npx @capacitor/cli@8 open ios`.

### Step 1 — TestFlight (first distribution)

Prerequisite: [Apple Developer Program](https://developer.apple.com/programs/)
membership ($99/year) on the Apple ID you sign with.

1. **Create the app record** — [App Store Connect](https://appstoreconnect.apple.com)
   → My Apps → **+** → New App: platform iOS, name *ActiveApps CRM*, bundle ID
   `com.activeapps.crm`, any unique SKU (e.g. `aa-crm`).
2. **Archive & upload** — in Xcode: Product → **Archive** → Distribute App →
   **App Store Connect** → Upload. Export compliance is answered automatically
   by the Info.plist key; processing takes ~5–15 minutes.
3. **Add testers** — App Store Connect → your app → **TestFlight** → Internal
   Testing → **+** group → add testers by their Apple ID email (up to 100,
   no review needed for internal groups).
4. Testers get an email → install the **TestFlight** app → accept the invite →
   install the CRM. New builds auto-notify testers.

**On-device checklist** (first TestFlight build): login → dashboard, start &
stop the timer, upload an attachment (should prompt with the new photo
permission text), toggle light/dark (status bar text should flip), rotate to
landscape (safe areas), and try a PDF export — blob downloads inside
WKWebView are a known Capacitor caveat; if saving fails on device, the fix is
a small native share-sheet handoff (scoped follow-up, not a TestFlight
blocker).

### Step 2 — App Store submission (when ready for public release)

In App Store Connect, complete the app page and submit the same build:

1. **Screenshots** — 6.9" iPhone set required; 13" iPad set too (the app is
   universal). Take them from the simulator (File → Save Screen).
2. **Metadata** — description, keywords, support URL.
3. **Privacy policy URL** — required for login-based apps; host one (e.g.
   `activeapps.io/privacy`).
4. **App Privacy questionnaire** — data collected: *Contact Info (email)* and
   *User Content (CRM records, photos users attach)*, linked to identity,
   **not** used for tracking.
5. **Demo account for App Review** — login-gated apps are rejected without
   one. Create a member-role user in Supabase Auth (e.g. `reviewer@…`) and
   put its credentials in *App Review Information → Sign-In Information*.
6. Add the build → Submit for Review (first review typically 1–3 days).

### Updating the native app

The shell bundles a snapshot of `dist/` — after web changes:

```bash
npm run ios:sync
```

then bump the **build number** (App target → General; marketing version only
for feature releases), re-archive and upload. TestFlight builds appear
automatically; App Store releases need a new submission.

If you prefer the native app to always show the latest deploy without
re-shipping, switch `capacitor.config.ts` to live mode:

```ts
const config: CapacitorConfig = {
  appId: "com.activeapps.crm",
  appName: "ActiveApps CRM",
  webDir: "dist",
  server: { url: "https://activeapps-crm-v3.vercel.app" },
};
```

(App Review generally expects bundled assets; the hosted-content mode is best
for internal/TestFlight distribution.)
