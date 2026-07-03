import type { CapacitorConfig } from "@capacitor/cli";

// Native iOS wrapper for the ActiveApps CRM web app.
// Bundles the built dist/ assets. Alternative: point at production for
// always-fresh content by replacing webDir usage with
//   server: { url: "https://activeapps-crm-v3.vercel.app" }
const config: CapacitorConfig = {
  appId: "com.activeapps.crm",
  appName: "ActiveApps CRM",
  webDir: "dist",
  ios: {
    contentInset: "always",
  },
};

export default config;
