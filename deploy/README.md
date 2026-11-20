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
| `nginx.conf` | nginx server configuration: single-page-app fallback, caching, gzip, security headers, an access log without personal data. |
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
   then shows in a box whether the build has an imprint and a privacy statement, with or
   without a postal address, and whether it may be indexed (see below),
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

## Imprint and privacy statement

The build takes the operator's details from `site.config.json` in the
repository root, which git ignores, or from the file that `SITE_CONFIG` names.
The fields and the three states (no legal pages; legal pages, not indexed;
legal pages, indexed) are described under "Running your own instance" in the
main [README](../README.md). The build is in whatever state the working tree is
in, and `deploy.sh` shows it before it uploads anything:

```text
################################################################################
##  Legal pages: NONE. No site config (site.config.json or SITE_CONFIG), so the
##  site has no imprint and no privacy statement and asks search engines not to
##  index it.
################################################################################
```

With a config, the box names the file and says whether search engines may
index the site. If the imprint has no postal address, it says that too:

```text
################################################################################
##  Legal pages: included, from /Users/you/budget-site.json, WITHOUT a postal
##  address for the operator. The site may be indexed by search engines
##  ("indexable": true).
################################################################################
```

It publishes in every state, so read the box. To keep the file outside the
repository: `SITE_CONFIG=$HOME/budget-site.json ./deploy/deploy.sh`.

The part of the privacy statement about hosting comes from the config, and it
is only true while this deployment does what the config says:

| The statement says | What makes it true |
| --- | --- |
| The server logs time, request, status, size and referrer, but no IP address and no user agent (`serverLog.fields`) | `log_format no_personal_data` in `nginx.conf` |
| The log is limited to 30 MB (`serverLog.retention`) | `logging` in `docker-compose.yml`: `json-file`, three files of 10 MB |
| Nothing else on the server logs visitors | Traefik's own configuration on the server, outside this repository: no `accessLog` section (checked on 18 November 2026) |
| Requests pass through Cloudflare, which asks browsers to report failed requests (`proxy`, `networkErrorReports`) | the proxied DNS record, and the `NEL` and `Report-To` headers that Cloudflare adds to every response |
| No cookies, no third-party scripts | the app, and Cloudflare as it is set up now: none of its responses sets a cookie and it adds nothing to the HTML |

Change one of these and the config with it. In the Cloudflare dashboard that
means: Web Analytics or Zaraz would add a script from another host, and bot
protection or a challenge page sets cookies (`__cf_bm`, `cf_clearance`); the
statement says nothing about either. If Traefik's access log is ever switched
on, it must leave out client addresses as well.

The statement names IONOS and Cloudflare as processors (Art. 28 GDPR), which
assumes a data processing agreement with each of them.

### The access log

nginx writes one line per request to the container's standard output, which
Docker keeps (`docker compose logs web` in the server directory):

```text
2026-11-18T21:30:03+00:00 "GET /assets/index-BqfUKBZT.js HTTP/1.1" 200 151080 "https://budget.drtheile.com/"
```

That is time, request line, status, bytes sent and referrer. The image's own
format would also log the client address (here always Traefik's address on
the `proxy` network), the `X-Forwarded-For` header (here a Cloudflare address,
since Traefik replaces the header of an untrusted sender) and the user agent.
nginx's error log goes to the same place; it names the client of a failed
request, which is again Traefik.

Docker keeps at most three files of 10 MB and deletes the oldest when the
third is full. Lines written before a change of the format stay until they are
rotated out; `docker compose up -d --force-recreate` starts the container with
an empty log.

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
