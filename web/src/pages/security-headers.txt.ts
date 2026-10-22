import type { APIRoute } from "astro";
export const GET: APIRoute = () =>
  new Response(`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; connect-src 'self' ${import.meta.env.PUBLIC_API_ORIGIN ?? "http://127.0.0.1:8788"} https://accounts.google.com; frame-src https://accounts.google.com; img-src 'self' data: https://*.googleusercontent.com https://www.gstatic.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
`);
