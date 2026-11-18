# Deployment

The site is a set of static files served by a small nginx container. The
container sits behind a Traefik reverse proxy that already runs on the server
and finds the container through its Docker labels. Nothing is built on the
server.

## The pieces

| File | Purpose |
| --- | --- |
| `deploy.sh` | The one command that publishes: build, upload, start or update the container, check the URL. |
| `docker-compose.yml` | The nginx container (Compose project `budget`, service `web`) and its Traefik labels. |
| `nginx.conf` | nginx server configuration: single-page-app fallback, caching, gzip, security headers. |
| `placeholder/index.html` | A static "under construction" page that can be published in place of the app. |

On the server everything lives in one directory (default `/home/deploy/budget`):

| On the server | What it is |
| --- | --- |
| `docker-compose.yml`, `nginx.conf` | Copies of the files above. Change them here in the repo and deploy; do not edit them on the server. |
| `.env` | Written by `deploy.sh`. Holds `SITE_HOST`, so `docker compose` commands typed on the server use the same hostname. |
| `nginx.conf.loaded` | Copy of the configuration nginx last loaded. `deploy.sh` uses it to see whether `nginx.conf` changed and to restore it if a new one is invalid. |
| `site/` | The web root. Replaced by every deploy; files that are no longer part of the upload are deleted. |

## One-time prerequisites

On the server:

- Docker with the Compose plugin (`docker compose`), plus `rsync`.
- A user that you can reach over ssh with a key, and that may run `docker`.
- Traefik v2 with the Docker provider, attached to an external Docker network
  named `proxy`, with an entrypoint named `websecure` on port 443 and a
  redirect from HTTP to HTTPS. Traefik itself is not managed from this
  repository and `deploy.sh` never touches it.

Elsewhere:

- A DNS record for the hostname that points to the server (directly or
  through Cloudflare, see below).
- On the machine you deploy from: `bash`, `ssh`, `rsync`, `curl`, and for the
  app build Node.js with `npm`. The versions that ship with macOS are enough.
  The ssh destination is an alias in `~/.ssh/config`; the default name is
  `ionos-deploy`.

## Deploy

From the repository root:

```sh
./deploy/deploy.sh --dry-run   # build, then show what rsync would change; the server is not touched
./deploy/deploy.sh             # build and publish
```

The script

1. runs `npm run build` and stops if the build fails or `dist/index.html` is missing,
2. uploads `docker-compose.yml`, `nginx.conf` and `.env`, then the contents of `dist/` to `site/`,
3. runs `docker compose up -d` on the server, which leaves a running, unchanged container alone,
4. if `nginx.conf` changed: checks it with `nginx -t` inside the container and reloads nginx.
   An invalid file is rejected, the previous one is restored, and the site keeps running,
5. fetches `https://<host>/` and prints the HTTP status. Anything but 200 makes the script fail.

Files are compared by content, so a second deploy of the same build uploads nothing.

Settings are environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `DEPLOY_HOST` | `ionos-deploy` | ssh destination |
| `DEPLOY_DIR` | `/home/deploy/budget` | directory on the server |
| `SITE_HOST` | `budget.drtheile.com` | public hostname; becomes the Traefik `Host(...)` rule |

Example: `SITE_HOST=budget.example.org DEPLOY_HOST=myserver ./deploy/deploy.sh`

## Publish the placeholder

```sh
./deploy/deploy.sh --placeholder
```

This uploads `deploy/placeholder/` in place of the app and does not build.
`--dry-run` works here too. Publishing the app again replaces the placeholder.

## Take the site down

```sh
ssh ionos-deploy 'cd /home/deploy/budget && docker compose down'
```

This stops and removes the container; Traefik then answers with its own 404.
The files stay on the server. `docker compose up -d` in the same directory, or
the next deploy, brings the site back.

## Cloudflare and the certificate

The DNS record for `budget.drtheile.com` is proxied through Cloudflare, so
visitors see Cloudflare's certificate. Cloudflare connects to the server over
HTTPS and accepts Traefik's default certificate there.

The Traefik router therefore has `tls=true` and no certificate resolver. The
resolver on this server (`myresolver`) uses the TLS-ALPN challenge, and that
challenge cannot succeed while Cloudflare terminates TLS in front of the
server. If the DNS record is ever switched to "DNS only", add this label in
`docker-compose.yml` and deploy:

```yaml
- "traefik.http.routers.budget.tls.certresolver=myresolver"
```

## Caching

| Path | `Cache-Control` sent by nginx |
| --- | --- |
| `/assets/*` (file names carry a content hash) | `public, max-age=31536000, immutable` |
| other `*.json` | `public, max-age=300` |
| `index.html`, app routes, every other file | `no-cache` |
| error responses | `no-store` |

Keep files without a content hash out of `/assets/`: browsers do not ask for
those again for a year.

Cloudflare's "Browser Cache TTL" setting for the zone overrides shorter
lifetimes on the file types Cloudflare caches (images, fonts, `.js`, `.css`
and similar). With the current setting, such a file outside `/assets/` reaches
browsers with `max-age=14400` (four hours) although nginx sends `no-cache`.
HTML and JSON pass through unchanged. To have Cloudflare follow nginx, set
Browser Cache TTL to "Respect Existing Headers" in the Cloudflare dashboard.

## Updating nginx

The image tag in `docker-compose.yml` is pinned to a minor version. To move to
another one, change the tag and deploy; the container is recreated, which
briefly interrupts the site. To pick up a patch release of the same tag, run
`docker compose pull && docker compose up -d` in the server directory.
