import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The test app (demo/), published on GitHub Pages under /home-trainer-kit/.
export default defineConfig({
  root: "demo",
  base: "./",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
});
