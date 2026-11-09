// Independent Vite + TanStack Start configuration for InvoiceFlow.
//
// This replaces the former `@lovable.dev/vite-tanstack-config` dependency with a
// self-maintained `defineConfig` helper. It reproduces the plugin composition,
// SSR wiring, env injection and build target that the project relied on, without
// any Lovable sandbox / preview behaviour.
//
// Plugin order (matching what the app expects):
//   1. TanStack devtools (dev server only, injected first)
//   2. @tailwindcss/vite
//   3. vite-tsconfig-paths (reads ./tsconfig.json)
//   4. @tanstack/react-start (SSR; builds the server entry from src/server.ts)
//   5. nitro/vite (production build only; Cloudflare module preset)
//   6. @vitejs/plugin-react
//
// It also injects VITE_* env vars into `import.meta.env.*`, sets the `@` alias to
// ./src, dedupes React / TanStack Query, and uses lightningcss as the CSS
// transformer — the same defaults the previous wrapper applied outside the
// Lovable sandbox.
//
// Build output: nitro's default `.output/` directory, with the `cloudflare-module`
// preset, so `.output/server/wrangler.json` is generated for Cloudflare Workers
// deployment (via `npx wrangler deploy` / `npx nitro deploy --prebuilt`).
// NITRO_PRESET / Vercel / Netlify / Cloudflare Pages auto-detection still wins if
// present, so self-hosting on another platform keeps working.
//
// IMPORTANT (carried over from the previous config):
//   - Do NOT set `ssr.external` / `resolve.external`: the Cloudflare Worker has no
//     runtime module resolution, so the build would fail.
//   - Do NOT add compression (vite-plugin-compression, compressPublicAssets):
//     hosting compresses at the edge; double-encoding renders garbled bodies.
import path from "node:path";
import { type ConfigEnv, type PluginOption, type UserConfig, loadEnv, mergeConfig } from "vite";

export interface TanstackStartConfigOptions {
  /** Extra Vite config merged on top of the defaults. */
  vite?: UserConfig;
  /** Extra plugins appended after the built-in ones. */
  plugins?: PluginOption[];
  /** Options forwarded to `tanstackStart()`. */
  tanstackStart?: Record<string, unknown>;
  /** Options forwarded to `viteReact()`. */
  react?: Record<string, unknown>;
  /**
   * Options forwarded to `nitro()` from `nitro/vite` on production builds.
   * `false` disables nitro entirely. Defaults to the `cloudflare-module` preset
   * unless a platform auto-detection env var (NITRO_PRESET, etc.) overrides it.
   */
  nitro?:
    | false
    | {
        preset?: string;
        output?: { dir?: string; publicDir?: string; serverDir?: string };
        cloudflare?: { nodeCompat?: boolean; deployConfig?: boolean };
      };
  /** Set to false to disable automatic VITE_* env define injection. Default: true. */
  envDefine?: boolean;
}

const ROOT = process.cwd();

export function defineConfig(options: TanstackStartConfigOptions = {}) {
  return async (env: ConfigEnv): Promise<UserConfig> => {
    const { command, mode } = env;
    const isDevBuild = command === "build" && mode === "development";

    const plugins: PluginOption[] = [];

    // 1. TanStack devtools — dev server only, injected first so source location
    //    tagging sees the untransformed JSX.
    if (mode === "development") {
      const { devtools } = await import("@tanstack/devtools-vite");
      plugins.push(
        devtools({
          enhancedLogs: { enabled: false },
          injectSource: { enabled: true },
        }),
      );
    }

    // 2. Tailwind CSS v4 Vite plugin.
    const tailwindcss = (await import("@tailwindcss/vite")).default;
    plugins.push(tailwindcss());

    // 3. tsconfig path aliases (reads ./tsconfig.json → "@/*").
    const tsConfigPaths = (await import("vite-tsconfig-paths")).default;
    plugins.push(tsConfigPaths({ projects: ["./tsconfig.json"] }));

    // 4. TanStack Start (SSR). `importProtection` keeps server-only modules out
    //    of the client bundle, matching the previous wrapper's default.
    const { tanstackStart } = await import("@tanstack/react-start/plugin/vite");
    const tanstackStartOptions = mergeConfig(
      {
        importProtection: {
          behavior: "error",
          client: {
            files: ["**/server/**"],
            specifiers: ["server-only"],
          },
        },
      },
      options.tanstackStart ?? {},
    );
    plugins.push(tanstackStart(tanstackStartOptions));

    // 5. Nitro — production builds only. Defaults to the Cloudflare module
    //    preset; zero-config platform auto-detection (NITRO_PRESET, Vercel,
    //    Netlify, Cloudflare Pages) still wins when present.
    if (options.nitro !== false && command === "build") {
      const { nitro } = await import("nitro/vite");
      const userNitroOpts = typeof options.nitro === "object" && options.nitro ? options.nitro : {};
      plugins.push(
        nitro({
          defaultPreset: "cloudflare-module",
          ...userNitroOpts,
        }),
      );
    }

    // 6. React plugin.
    const viteReact = (await import("@vitejs/plugin-react")).default;
    plugins.push(viteReact(options.react));

    // VITE_* env injection into import.meta.env.*
    const envDefine: Record<string, string> = {};
    if (options.envDefine !== false) {
      const loadedEnv = loadEnv(mode, ROOT, "VITE_");
      for (const [key, value] of Object.entries(loadedEnv)) {
        envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
      }
    }

    let config: UserConfig = {
      define: envDefine,
      css: { transformer: "lightningcss" },
      resolve: {
        alias: { "@": path.resolve(ROOT, "src") },
        dedupe: [
          "react",
          "react-dom",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
          "@tanstack/react-query",
          "@tanstack/query-core",
        ],
      },
      optimizeDeps: {
        include: [
          "react",
          "react-dom",
          "react-dom/client",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
        ],
      },
      plugins: [...plugins, ...(options.plugins ?? [])],
    };

    // `build --mode development` keeps the client in dev mode with readable names
    // (parity with the previous config's dev-build behaviour). `esbuild.keepNames`
    // is a valid esbuild transform option Vite passes through; the extras object is
    // cast because Vite's ESBuildOptions type does not declare `keepNames`.
    if (isDevBuild) {
      const devBuildExtras = {
        environments: {
          client: {
            define: { "process.env.NODE_ENV": JSON.stringify("development") },
          },
        },
        esbuild: { keepNames: true },
      } as unknown as UserConfig;
      config = mergeConfig(config, devBuildExtras);
    }

    if (options.vite) config = mergeConfig(config, options.vite);

    // Local dev server defaults (previously applied outside the Lovable sandbox).
    config = mergeConfig({ server: { host: "::", port: 8080 } }, config);

    return config;
  };
}
