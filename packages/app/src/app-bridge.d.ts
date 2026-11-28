// client.js imports './app-bridge.js', a file the server serves next to it (the @shopnex/app-bridge package, see index.ts).
// This is only there so TypeScript can check that import.
export { createAppBridge } from '@shopnex/app-bridge'
