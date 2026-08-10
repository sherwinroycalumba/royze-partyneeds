import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Enables `forbidden()` / `unauthorized()`, used by the auth DAL to
    // render proper 403 pages on role violations (Spec 3).
    authInterrupts: true,
  },

  // The PDF renderer pulls in fontkit, which reads font files from disk
  // — bundling it breaks that, so it stays a real Node dependency.
  serverExternalPackages: ["@react-pdf/renderer"],

  // The bundled Inter fonts are read at request time by path, so the
  // deployment tracer has to be told to ship them: without this the
  // PDF routes work locally and 500 in production.
  outputFileTracingIncludes: {
    "/**": ["./lib/pdf/fonts/*.ttf"],
  },
};

export default nextConfig;
