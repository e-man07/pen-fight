import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a second dev server use its own build dir: NEXT_DIST_DIR=.next-alt pnpm dev
  distDir: process.env.NEXT_DIST_DIR || ".next",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
