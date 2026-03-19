import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-separator'],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
