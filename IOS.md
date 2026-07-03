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

## 2. Native app — Capacitor Xcode project (App Store capable)

The `ios/` directory is a complete Capacitor 8 Xcode project
(`appId com.activeapps.crm`, Swift Package Manager — no CocoaPods required)
that wraps the built web app in a native WKWebView shell.

### Build & run (requires macOS + Xcode 15+)

```bash
npm install
npm run build          # builds the web app into dist/
npx cap sync ios       # copies dist/ into the native project
npx cap open ios       # opens ios/App in Xcode
```

In Xcode: select the **App** target → *Signing & Capabilities* → choose your
Apple Developer team → pick a simulator or plugged-in iPhone → **Run**.

### Ship to the App Store

1. Set the version/build number on the App target.
2. Product → Archive → Distribute App (App Store Connect).
3. App icons: Xcode reads `ios/App/App/Assets.xcassets` — replace the
   placeholder set with the brand icons in `public/icon-512.png` /
   `public/icon-512-maskable.png` (dark-navy background, App Store requires
   opaque 1024×1024 for the marketing icon).

### Updating the native app

The shell bundles a snapshot of `dist/` — after web changes, re-run
`npm run build && npx cap sync ios` and re-archive. If you prefer the native
app to always show the latest deploy without re-shipping, switch
`capacitor.config.ts` to live mode:

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
