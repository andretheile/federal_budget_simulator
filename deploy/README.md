# Deployment

The site is a set of static files served by a small nginx container. The
container sits behind a Traefik reverse proxy that already runs on the server
and finds the container through its Docker labels. Nothing is built on the
server.

## The pieces

| File | Purpose |
| --- | --- |
| `deploy.sh` | The one command that publishes: build, upload, start or update the container, check the public addresses. |
| `docker-compose.yml` | The nginx container (Compose project `budget`, service `web`) and its Traefik labels. |
| `docker-compose.redirect.yml` | More Traefik labels for the same container: the redirect from former host names (see "Former host names"). Read only when there are any. |
| `nginx.conf` | nginx server configuration: single-page-app fallback, caching, gzip, security headers, an access log without personal data. |
| `placeholder/index.html` | A static "under construction" page that can be published in place of the app. |

On the server everything lives in one directory (default `/home/deploy/budget`):

| On the server | What it is |
| --- | --- |
| `docker-compose.yml`, `docker-compose.redirect.yml`, `nginx.conf` | Copies of the files above. Change them here in the repo and deploy; do not edit them on the server. |
| `.env` | Written by `deploy.sh`. Holds `SITE_HOST` and, with former host names, `COMPOSE_FILE` and `SITE_REDIRECT_RULE`, so `docker compose` commands typed on the server use the same configuration. |
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
  through Cloudflare, see below), and one for each former hostname that
  should keep redirecting.
- On the machine you deploy from: `bash`, `ssh`, `rsync`, `curl`, and for the
  app build Node.js with `npm`. The versions that ship with macOS are enough.
  The ssh destination is an alias in `~/.ssh/config`; the default name is
  `ionos-deploy`.

## Deploy

From the repository root:

```sh
./deploy/deploy.sh --dry-run   # build, then show the routing and what rsync would change; the server is not touched
./deploy/deploy.sh             # build and publish
./deploy/deploy.sh --check     # only check the public addresses (step 5); nothing is built or uploaded
```

The script

1. runs `npm run build` and stops if the build fails or `dist/index.html` is missing,
   then shows in a box which countries the build contains and which it left out as
   previews, whether it has an imprint and a privacy statement, with or without a postal
   address, and whether it may be indexed (see below),
2. shows the routing it is about to configure: the host name that serves the site, the
   former names that redirect to it, and the `.env` that says so (also in a dry run),
   then uploads `docker-compose.yml`, `docker-compose.redirect.yml`, `nginx.conf` and
   `.env`, then the contents of `dist/` to `site/`,
3. runs `docker compose up -d` on the server, which leaves a running, unchanged container
   alone and recreates it when its labels changed (see "Former host names"),
4. if `nginx.conf` changed: checks it with `nginx -t` inside the container and reloads nginx.
   An invalid file is rejected, the previous one is restored, and the site keeps running,
5. checks the public addresses: `https://<SITE_HOST>/` must answer 200, and each former
   name must answer with a permanent redirect (301) to the same path and query on
   `SITE_HOST`, for `/` and for a path with a query. Anything else makes the script fail.

Files are compared by content, so a second deploy of the same build uploads nothing.

Settings are environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `DEPLOY_HOST` | `ionos-deploy` | ssh destination |
| `DEPLOY_DIR` | `/home/deploy/budget` | directory on the server |
| `SITE_HOST` | `fiscal.drtheile.com` | public hostname; becomes the Traefik `Host(...)` rule |
| `SITE_FORMER_HOSTS` | `budget.drtheile.com`, but only while `SITE_HOST` is `fiscal.drtheile.com`; empty for any other | former hostnames, separated by spaces or commas, that redirect permanently to `SITE_HOST` (see "Former host names"). Set but empty (`SITE_FORMER_HOSTS=`): none |

Examples: `SITE_HOST=sim.example.org DEPLOY_HOST=myserver ./deploy/deploy.sh`, and
for a site that moved: `SITE_HOST=sim.example.org SITE_FORMER_HOSTS="old.example.org www.old.example.org" ./deploy/deploy.sh`

## Imprint and privacy statement

The build takes the operator's details from `site.config.json` in the
repository root, which git ignores, or from the file that `SITE_CONFIG` names.
The fields and the three states (no legal pages; legal pages, not indexed;
legal pages, indexed) are described under "Running your own instance" in the
main [README](../README.md). The build is in whatever state the working tree is
in, and `deploy.sh` shows it before it uploads anything:

```text
################################################################################
##  Countries: de, us.
##
##  Legal pages: NONE. No site config (site.config.json or SITE_CONFIG), so the
##  site has no imprint and no privacy statement and asks search engines not to
##  index it.
################################################################################
```

The first line names the country packs the build contains. A pack under
construction marks itself `"preview": true` in its `country.json` and is left
out of the build, so it cannot go live by accident; the line then names it as
well, for example `Countries: de, us. Left out as previews: fr
(PREVIEW_PACKS=include builds them in).` (see "Adding or changing a country"
in the main [README](../README.md)). `deploy.sh` builds without previews unless
`PREVIEW_PACKS=include` is set in its environment, and the box then says that
it built them in.

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
2026-11-18T21:30:03+00:00 "GET /assets/index-BqfUKBZT.js HTTP/1.1" 200 151080 "https://fiscal.drtheile.com/"
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

## Former host names

The site moved from `budget.drtheile.com` to `fiscal.drtheile.com` in November
2026. The old name keeps working: every request to it gets a permanent
redirect (301; 308 for methods other than GET) to the same path and query on
the new name. The part of a link after `#`, which holds a shared scenario,
never reaches the server; the browser keeps it across the redirect, so shared
links open as before.

`SITE_FORMER_HOSTS` lists such names. Its default, `budget.drtheile.com`,
holds only while `SITE_HOST` is `fiscal.drtheile.com`; with any other
`SITE_HOST` it is empty, so a copy of this setup never routes a name of ours.
`SITE_FORMER_HOSTS=` (set, but empty) means none.

Traefik does the redirect, not nginx. Traefik already routes by host name and
gets the names from `.env`, while nginx stays the same for every operator and
never sees a request for a former name (nor logs one). With former names,
`deploy.sh` adds two lines to `.env`:

```text
COMPOSE_FILE=docker-compose.yml:docker-compose.redirect.yml
SITE_REDIRECT_RULE='Host(`budget.drtheile.com`)'
```

`docker compose` then also reads `docker-compose.redirect.yml`, which gives the
same container a router `budget-redirect` for those names and two middlewares:
`budget-redirect` (the redirect) and `budget-redirect-cache` (sets
`Cache-Control: max-age=3600` on the redirect). Without former names neither
line is written, the file is not read, and Traefik has no router and no
middleware for any other name. All names start with `budget`, like the site's
own router and service, because Traefik keeps the names of every container on
the server in one namespace.

Browsers keep a 301 without a lifetime for good. With one hour they ask
again after an hour, so the move can still be taken back: an hour after the
redirect is gone, no browser follows it any more. Search engines treat the 301
as permanent either way.

### Switching, and going back

A change of `SITE_HOST` or `SITE_FORMER_HOSTS` changes the container's
labels, and `docker compose up -d` then recreates the container: it stops the
old one and starts a new one with the same files. In a test with a local
Traefik v2.11 that took one to two seconds, and Traefik needed another second
or two to route the new container. For about three seconds, requests to
either name got a 502 or Traefik's 404, and a page loaded in exactly that
moment has to be reloaded. Nothing else is affected: Traefik keeps running and
is not reconfigured beyond this container's routers, and the `proxy` network
and every other container stay as they are. The container's log starts empty,
as after `--force-recreate` (see "The access log").

A page that was already open on the old name keeps running there. If it then
loads a part on demand for the first time (the curve editor, the debt
projection, the details of a goal), that request is redirected to the new
name, and the browser refuses a script from another name. The part does not
open until the page is reloaded, which then happens on the new name.

To go back to serving the site on the old name only:

```sh
SITE_HOST=budget.drtheile.com SITE_FORMER_HOSTS= SITE_CONFIG=$HOME/budget-site.json ./deploy/deploy.sh
```

That writes the labels as they were before the move (the router `budget` for
`budget.drtheile.com`, no redirect) and recreates the container once more.
`fiscal.drtheile.com` then answers Traefik's 404 again. A browser that got the
redirect in the hour before still follows it, to that 404, until an hour has
passed since it got it. Do not swap the names instead (new name as former,
old as site) within that hour: a browser that still holds the 301 from the
old name to the new one would be sent back and forth.

## Cloudflare and the certificate

The DNS records for `fiscal.drtheile.com` and for the former name
`budget.drtheile.com` are proxied through Cloudflare, so visitors see
Cloudflare's certificate. Cloudflare connects to the server over HTTPS and
accepts Traefik's default certificate there. The record for the former name
must stay as long as its links should keep working.

The Traefik routers therefore have `tls=true` and no certificate resolver. The
resolver on this server (`myresolver`) uses the TLS-ALPN challenge, and that
challenge cannot succeed while Cloudflare terminates TLS in front of the
server. If the DNS records are ever switched to "DNS only", add these labels
(the second in `docker-compose.redirect.yml`) and deploy:

```yaml
- "traefik.http.routers.budget.tls.certresolver=myresolver"
- "traefik.http.routers.budget-redirect.tls.certresolver=myresolver"
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
