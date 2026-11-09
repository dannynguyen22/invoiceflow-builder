// Independent Vite + TanStack Start configuration (see ./config/vite-tanstack.ts).
// The helper composes, in order: TanStack devtools (dev-only, first), tailwindcss,
// vite-tsconfig-paths, tanstackStart, nitro (build-only, Cloudflare module preset
// by default), and viteReact. It also injects VITE_* env vars, sets the @ -> ./src
// alias, and dedupes React / TanStack Query.
//
// Never set ssr.external or resolve.external: the Cloudflare Worker has no runtime
// module resolution, so the build fails. Never add compression
// (compressPublicAssets, vite-plugin-compression): hosting already compresses at
// the edge. Pass extra config via defineConfig({ vite: { ... }, ... }) if needed.
import { defineConfig } from "./config/vite-tanstack";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR
    // error wrapper). nitro/vite builds from this.
    server: { entry: "server" },
  },
});
