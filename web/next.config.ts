import type { NextConfig } from 'next';

// Exported as static files and served by the zero-dependency Node server in ../app.
const config: NextConfig = {
  output: 'export',
  trailingSlash: false,
  images: { unoptimized: true },
};
export default config;
