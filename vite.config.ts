import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: "dist",
    // Increase chunk size warning limit to 1.2 MB to avoid noisy warnings
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`,
      },
    },
  },
  // Set explicitly to the GitHub Pages subpath so absolute asset URLs resolve
  // correctly when served at https://<user>.github.io/HazmatVizualizer/.
  // Override at build time with `BASE_PATH=/ npm run build` for root-domain hosts.
  base: process.env.BASE_PATH ?? "/HazmatVizualizer/",
});
