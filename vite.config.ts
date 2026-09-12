import { defineConfig } from "vite-plus";
import solid from "vite-plugin-solid";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    dts: {
      tsgo: true,
    },
    exports: {
      customExports: {
        "./tui": "./dist/tui/tui.js",
      },
    },
  },
  plugins: [solid({ solid: { generate: "universal", moduleName: "@opentui/solid" } })],
  build: {
    outDir: "dist/tui",
    emptyOutDir: true,
    minify: false,
    target: "esnext",
    lib: {
      entry: "src/tui.ts",
      formats: ["es"],
      fileName: "tui",
    },
    rollupOptions: {
      external: [
        /^solid-js/,
        /^@opentui\//,
        /^effect$/,
        /^@opencode-ai\//,
        /^@opencode\//,
        /^node:/,
      ],
    },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
