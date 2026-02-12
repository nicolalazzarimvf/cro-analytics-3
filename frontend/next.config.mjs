import { resolve } from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // Deduplicate Three.js — react-force-graph-3d bundles its own copy,
    // and we also import it directly in GraphCard.tsx. This ensures only
    // one instance is loaded, silencing the "Multiple instances" warning.
    config.resolve.alias = {
      ...config.resolve.alias,
      "three$": resolve("node_modules/three"),
    };
    return config;
  },
};

export default nextConfig;

