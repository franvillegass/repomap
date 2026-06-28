/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverRuntimeConfig: {
    initialGraphPath: process.env.REPOMAP_GRAPH_FILE,
  },
}

module.exports = nextConfig