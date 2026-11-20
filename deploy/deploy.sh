#!/usr/bin/env bash
# Publish the static site to the server.
#
#   ./deploy/deploy.sh                 build the app (npm run build) and upload dist/
#   ./deploy/deploy.sh --placeholder   upload deploy/placeholder/ instead, without building
#   ./deploy/deploy.sh --dry-run       show what rsync would change; change nothing on the
#                                      server (can be combined with --placeholder)
#
# Environment variables and their defaults:
#   DEPLOY_HOST=ionos-deploy         ssh destination (an alias from ~/.ssh/config)
#   DEPLOY_DIR=/home/deploy/budget   directory on the server
#   SITE_HOST=budget.drtheile.com    public hostname of the site
#
# Needs bash, ssh, rsync and curl (the versions that ship with macOS are enough)
# and, for the build, npm. See deploy/README.md.
#
# Before anything is uploaded, the script says in a box whether the site has its
# imprint and privacy statement (site.config.json, see the README), whether the
# imprint lacks a postal address, and whether search engines may index it. It
# publishes either way: read the box.

set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-ionos-deploy}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/deploy/budget}"
SITE_HOST="${SITE_HOST:-budget.drtheile.com}"

die()  { echo "deploy: $*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }
# A message nobody scrolls past: framed, wrapped to 76 columns.
banner() {
  local rule="################################################################################"
  printf '\n%s\n' "$rule"
  printf '%s\n' "$*" | fold -s -w 76 | sed -e 's/ *$//' -e 's/^/##  /'
  printf '%s\n\n' "$rule"
}

placeholder=0
dry_run=0
for arg in "$@"; do
  case "$arg" in
    --placeholder) placeholder=1 ;;
    --dry-run)     dry_run=1 ;;
    -h|--help)     sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)             die "unknown option '$arg' (known: --placeholder, --dry-run, --help)" ;;
  esac
done

# Both values end up in commands that the remote shell interprets, so keep them plain.
DEPLOY_DIR="${DEPLOY_DIR%/}"
case "$DEPLOY_DIR" in
  /*) ;;
  *)  die "DEPLOY_DIR must be an absolute path, got '$DEPLOY_DIR'" ;;
esac
case "$DEPLOY_DIR" in
  *[!A-Za-z0-9._/-]*) die "DEPLOY_DIR may only contain letters, digits and . _ - /, got '$DEPLOY_DIR'" ;;
esac
case "$SITE_HOST" in
  ""|*[!A-Za-z0-9.-]*) die "SITE_HOST must be a plain hostname, got '$SITE_HOST'" ;;
esac

for tool in ssh rsync curl; do
  command -v "$tool" >/dev/null || die "'$tool' is not installed"
done

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$here")"
remote="$DEPLOY_HOST:$DEPLOY_DIR"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# --- 1. What to upload ------------------------------------------------------

if [ "$placeholder" = 1 ]; then
  src="$here/placeholder"
  legal="Legal pages: NONE. The placeholder has no imprint and no privacy statement and asks search engines not to index it."
else
  command -v npm >/dev/null || die "'npm' is not installed, cannot build the app"
  step "Building the app (npm run build in $root)"
  # The build says in one line starting with "Legal pages:" whether the site has
  # its imprint and privacy statement; keep a copy of the output to find it.
  (cd "$root" && npm run build) 2>&1 | tee "$tmp/build.log" || die "the build failed; nothing was uploaded"
  legal="$(grep '^Legal pages:' "$tmp/build.log" | tail -n 1 || true)"
  src="$root/dist"
fi
[ -f "$src/index.html" ] || die "$src/index.html is missing; nothing was uploaded"

step "Imprint and privacy statement"
banner "${legal:-Legal pages: UNKNOWN. The build did not say whether the site has an imprint and a privacy statement; read the build output above.}"

# --- 2. Upload ---------------------------------------------------------------

# Only long-standing rsync options, because macOS ships its own rsync
# (openrsync), which lacks newer ones; that is the client this was tested with.
# -c compares file contents, not timestamps: an unchanged file is left alone on
# the server even after a rebuild, so its ETag stays stable.
rsync_opts=(-rc -i --exclude .DS_Store -e "ssh -o BatchMode=yes")
if [ "$dry_run" = 1 ]; then
  rsync_opts+=(--dry-run)
fi

upload() {
  local out
  # sed only drops the empty lines that macOS's rsync prints between deletions
  out="$(rsync "${rsync_opts[@]}" "$@" | sed '/^$/d')" || die "rsync failed; see the message above"
  if [ -n "$out" ]; then
    printf '%s\n' "$out"
  else
    echo "(no changes)"
  fi
}

# docker compose reads SITE_HOST from a .env file next to docker-compose.yml, so
# compose commands typed on the server later see the same hostname.
printf '# Written by deploy.sh\nSITE_HOST=%s\n' "$SITE_HOST" > "$tmp/.env"

if [ "$dry_run" = 1 ]; then
  step "Dry run: the server is not changed. Lines below are what rsync would do."
else
  step "Ensuring $remote/site exists"
  ssh -o BatchMode=yes "$DEPLOY_HOST" "mkdir -p '$DEPLOY_DIR/site'"
fi

# --inplace: nginx.conf is bind-mounted into the container as a single file, and
# the container only sees changes written into that same file. rsync's default
# (write a temporary file, then rename it) would leave the container on the old one.
step "Configuration -> $remote/"
upload --inplace "$here/docker-compose.yml" "$here/nginx.conf" "$tmp/.env" "$remote/"

# The live page must never point at files that are not there. rsync sends
# index.html before the assets directory and, with plain --delete, removes old
# files first. So: upload everything except index.html, then index.html, and
# remove files that are gone from the build only at the very end (--delete-after).
# A dry run shows it all in one pass.
step "Site: $src/ -> $remote/site/"
if [ "$dry_run" = 0 ]; then
  echo "-- new and changed files, except index.html"
  upload --exclude /index.html "$src/" "$remote/site/"
  echo "-- index.html, then removal of files that are no longer part of the site"
fi
upload --delete --delete-after "$src/" "$remote/site/"

if [ "$dry_run" = 1 ]; then
  step "Dry run finished. Skipped: creating the directory, docker compose up, nginx reload, HTTP check."
  exit 0
fi

# --- 3. Start or update the container ---------------------------------------

# The script reaches the remote shell on stdin. Everything runs inside main,
# called with stdin from /dev/null, so that no command (docker compose exec
# reads stdin) can swallow the rest of the script.
step "Container on $DEPLOY_HOST (docker compose up -d in $DEPLOY_DIR)"
ssh -o BatchMode=yes "$DEPLOY_HOST" "cd '$DEPLOY_DIR' && sh -s" <<'REMOTE' || die "the step on the server failed; see the messages above"
set -eu

main() {
  # nginx runs as an unprivileged user inside the container
  chmod -R a+rX site

  # Idempotent: an unchanged, running container is left alone.
  docker compose up -d

  # nginx.conf.loaded is a copy of the configuration nginx last loaded.
  if cmp -s nginx.conf nginx.conf.loaded; then
    echo "nginx.conf: unchanged, no reload"
  else
    echo "nginx.conf: changed, validating inside the container"
    if ! docker compose exec -T web nginx -t; then
      if [ -f nginx.conf.loaded ]; then
        # Written in place, so the container sees the restored file.
        cat nginx.conf.loaded > nginx.conf
        echo "ERROR: nginx rejected the new nginx.conf (see above). The previous" >&2
        echo "       nginx.conf was restored on the server and stays in effect." >&2
      else
        echo "ERROR: nginx -t failed on the first start (see above). Container state:" >&2
        docker compose ps -a >&2 || true
        docker compose logs --tail 20 web >&2 || true
      fi
      exit 1
    fi
    if ! docker compose exec -T web cat /etc/nginx/conf.d/default.conf | cmp -s - nginx.conf; then
      echo "ERROR: the container does not see the uploaded nginx.conf. The file on the" >&2
      echo "       server was replaced instead of rewritten in place. Run" >&2
      echo "       'docker compose up -d --force-recreate' in $PWD and deploy again." >&2
      exit 1
    fi
    docker compose exec -T web nginx -s reload
    cp nginx.conf nginx.conf.loaded
    echo "nginx.conf: valid, nginx reloaded"
  fi

  docker compose ps
}

main </dev/null
REMOTE

# --- 4. Check the public URL -------------------------------------------------

step "Checking https://$SITE_HOST/"
status=000
for _ in 1 2 3 4 5; do
  status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$SITE_HOST/" || true)"
  if [ "$status" = 200 ]; then
    break
  fi
  sleep 2
done
echo "https://$SITE_HOST/ -> HTTP $status"
[ "$status" = 200 ] || die "expected HTTP 200. The files are uploaded and the container was started; check Traefik, DNS and the container logs."
