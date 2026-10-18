# Timeline: tech stack

Version 1.3.1. Three parts in one repo (`server/`, `web/`, `mobile/`), shipped as one Docker image plus an Android APK.

## Server (`server/`)
| Area | Choice |
|---|---|
| Runtime | Node 24, TypeScript run directly with `tsx` (no build step) |
| HTTP framework | Hono 4 with `@hono/node-server` |
| API definition | `@hono/zod-openapi` + Zod 4 (validation and OpenAPI spec) |
| Database | PostgreSQL 18 via `postgres` (postgres.js); plain SQL migrations in `migrations/` |
| Auth | Session tokens (`tls_`) for people; API keys (`tlk_`) with scopes read / write / delete / purge for agents |
| AI agents | REST API plus an MCP server at `/mcp` (`@modelcontextprotocol/sdk`) |
| Media | ffmpeg (thumbnails, HLS reels renditions, avatar crop to 256 px WebP); signed relative URLs `/m/<exp>/<sig>/<id>/<file>` |
| Post from URL | yt-dlp (needs python3) |
| Storage backends | Google Drive (`googleapis`, OAuth, `drive.file` scope), S3-compatible (`@aws-sdk/client-s3`, `lib-storage`, `s3-request-presigner`: Backblaze B2, Cloudflare R2, AWS S3), local disk |
| Push | Firebase Cloud Messaging (`firebase-admin`) for Android; `web-push` for browsers |
| Background work | Job queue and worker in Postgres (`jobs/`): transcodes, reminders, trash auto-purge |
| App updates | `/api/app/update` reads the newest GitHub Release and proxies the APK |
| Encryption | Storage credentials encrypted with a key derived from `APP_SECRET` |

Dependencies: hono ^4.13, @hono/node-server ^2.1, @hono/zod-openapi ^1.6, zod ^4.6, postgres ^3.4, tsx ^4.23, @modelcontextprotocol/sdk ^1.32, googleapis ^186, firebase-admin ^14.5, web-push ^3.6, @aws-sdk/* ^3.1152, TypeScript 5.9.

## Web app (`web/`)
| Area | Choice |
|---|---|
| UI | React 19 |
| Build | Vite 7, `@vitejs/plugin-react` |
| Styling | Tailwind CSS 4 (`@tailwindcss/vite`), CSS variable theme tokens, light/dark and accent themes |
| Routing | React Router 7 |
| Data | TanStack Query 5, TanStack Virtual (long feeds) |
| Video | hls.js |
| Icons | lucide-react |
| Language | TypeScript 5.9 |

The production build is served by the server itself, so web and API share one origin and one port.

## Mobile app (`mobile/`)
| Area | Choice |
|---|---|
| Framework | Expo SDK 58, React Native 0.88, React 19.3 |
| Platform | Android only (package `app.timeline.mobile`), arm64-v8a build, about 37 MB |
| Routing | expo-router 58 |
| Lists | @shopify/flash-list 2.3 |
| Data | TanStack Query 5 |
| Media | expo-image, expo-video, expo-image-picker, expo-document-picker |
| Storage | expo-secure-store (token and server address) |
| Push | expo-notifications + Firebase (needs `google-services.json`) |
| Updates | expo-file-system + expo-intent-launcher (needs `REQUEST_INSTALL_PACKAGES`) |
| Other | netinfo, expo-clipboard, expo-device, expo-linking, expo-web-browser, react-native-svg, safe-area-context, screens, lucide-react-native |
| Build | `expo prebuild` + Gradle, local; debug-keystore signed (back it up so updates keep working) |
| Language | TypeScript 6 |

Cleartext `http://` is allowed (`expo-build-properties`) so the app can talk to a LAN server.

## Infrastructure
- **Docker:** multi-stage `Dockerfile` (node:24-alpine; ffmpeg, python3, yt-dlp, tini, su-exec). `docker-compose.yml` runs the app and `postgres:18-alpine`.
- **Port:** 8080 for the API, web UI and media.
- **HTTPS:** put Caddy or a Cloudflare Tunnel in front (needed for Google Drive OAuth and push on a real domain).
- **Data:** `/data` volume (thumbnails, renditions, upload spool, local files); Postgres volume.
- **Config:** environment variables (`PUBLIC_URL`, `APP_SECRET`, `DATABASE_URL`, `ADMIN_*`, `GOOGLE_*`, `S3_*`, `FIREBASE_SERVICE_ACCOUNT_FILE`, `TRASH_RETENTION_DAYS`, `UPDATE_REPO`, `UPDATE_GITHUB_TOKEN`, `MEDIA_CONCURRENCY`, `HLS_HEIGHTS`, `YTDLP_COOKIES_FILE`).
- **Releases:** GitHub Releases (`uri-travoski/timeline`, public) with `timeline-<version>.apk` and `timeline.apk`.

## Testing and tooling
- Playwright (Chromium) for web screenshots and flows; Android emulator for the app.
- Node 24 is required for Expo builds.
