/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["labs.graptolite.ai"],
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || ""
};

export default nextConfig;
