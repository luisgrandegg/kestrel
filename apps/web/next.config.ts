import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @kestrel/core and @kestrel/ingest are consumed as TypeScript SOURCE
  // (their package.json "exports" point at .ts files), so Next must
  // transpile them itself.
  transpilePackages: ["@kestrel/core", "@kestrel/ingest"],
  // Those packages use NodeNext-style relative specifiers ("./base.js"
  // for base.ts); teach webpack the same .js → .ts substitution tsc does.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
