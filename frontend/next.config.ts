import type { NextConfig } from "next";

// Export estático: `next build` genera frontend/out, que el workflow de deploy
// sube a S3 y sirve CloudFront (tarea 3.5). Toda la app es cliente: la sesión
// vive en Supabase Auth y los datos se piden a la API de Lambda.
const nextConfig: NextConfig = {
  output: "export",
  // Cada ruta se exporta como <ruta>/index.html, así S3 + CloudFront la
  // resuelven con la función de reescritura de infra/cloudfront.
  trailingSlash: true,
  // Sin servidor no hay optimizador de imágenes.
  images: { unoptimized: true },
};

export default nextConfig;
