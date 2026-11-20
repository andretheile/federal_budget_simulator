#!/usr/bin/env bash
# Publish the static site to the server.
#
#   ./deploy/deploy.sh                 build the app (npm run build) and upload dist/
#   ./deploy/deploy.sh --placeholder   upload deploy/placeholder/ instead, without building
#   ./deploy/deploy.sh --dry-run       show what rsync would change; change nothing on the
#                                      server (can be combined with --placeholder)
#   ./deploy/deploy.sh --check         only check the public addresses (step 4);
#                                      build, upload and change nothing
#
# Environment variables and their defaults:
#   DEPLOY_HOST=ionos-deploy         ssh destination (an alias from ~/.ssh/config)
#   DEPLOY_DIR=/home/deploy/budget   directory on the server
#   SITE_HOST=fiscal.drtheile.com    public hostname of the site
#   SITE_FORMER_HOSTS=budget.drtheile.com
#                                    former hostnames, separated by spaces or commas;
#                                    each redirects permanently to SITE_HOST, keeping
#                                    path and query. This default holds only while
#                                    SITE_HOST is fiscal.drtheile.com; for another
#                                    SITE_HOST it is empty. SITE_FORMER_HOSTS= (set,
#                                    but empty) means none.
#
# Needs bash, ssh, rsync and curl (the versions that ship with macOS are enough)
# and, for the build, npm. See deploy/README.md.
#
# Before anything is uploaded, the script says in a box which countries the build
# contains and which it left out as previews (a pack that marks itself
# "preview": true in its country.json is left out unless PREVIEW_PACKS=include
# is set), whether the site has its imprint and privacy statement
# (site.config.json, see the README), whether the imprint lacks a postal
# address, and whether search engines may index it. It publishes either way:
# read the box.

set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-ionos-deploy}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/deploy/budget}"
SITE_HOST="${SITE_HOST:-fiscal.drtheile.com}"
# This instance moved from budget.drtheile.com, which keeps redirecting. The
# default belongs to this instance's own name only, so that whoever sets
# SITE_HOST for a site of their own gets no router for a name of ours.
if [ -z "${SITE_FORMER_HOSTS+set}" ]; then
  if [ "$SITE_HOST" = fiscal.drtheile.com ]; then
    SITE_FORMER_HOSTS=budget.drtheile.com
  else
    SITE_FORMER_HOSTS=
  fi
fi

die()  { echo "deploy: $*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }
# A message nobody scrolls past: framed, wrapped to 76 columns.
banner() {
  local rule="################################################################################"
  printf '\n%s\n' "$rule"
  printf '%s\n' "$*" | fold -s -w 76 | sed -e 's/^/##  /' -e 's/ *$//'
  printf '%s\n\n' "$rule"
}

placeholder=0
dry_run=0
check_only=0
for arg in "$@"; do
  case "$arg" in
    --placeholder) placeholder=1 ;;
    --dry-run)     dry_run=1 ;;
    --check)       check_only=1 ;;
    -h|--help)     sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)             die "unknown option '$arg' (known: --placeholder, --dry-run, --check, --help)" ;;
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

# The former names, checked like SITE_HOST: each becomes a Host(...) in a
# Traefik rule. (Written for the bash 3.2 of macOS: an empty array counts as
# unset there, hence the ${former[@]+...} below.)
lower() { printf '%s' "$1" | tr 'A-Z' 'a-z'; }
former=()
read -r -a listed <<< "$(printf '%s' "$SITE_FORMER_HOSTS" | tr ',\t\n' '   ')"
for host in ${listed[@]+"${listed[@]}"}; do
  case "$host" in
    *[!A-Za-z0-9.-]*) die "SITE_FORMER_HOSTS must list plain hostnames, separated by spaces or commas, got '$host'" ;;
  esac
  [ "$(lower "$host")" != "$(lower "$SITE_HOST")" ] || die "SITE_FORMER_HOSTS lists '$host', which is SITE_HOST itself"
  for seen in ${former[@]+"${former[@]}"}; do
    [ "$(lower "$seen")" != "$(lower "$host")" ] || die "SITE_FORMER_HOSTS lists '$host' twice"
  done
  former+=("$host")
done
redirect_rule=""
for host in ${former[@]+"${former[@]}"}; do
  redirect_rule="${redirect_rule:+$redirect_rule || }Host(\`$host\`)"
done

for tool in ssh rsync curl; do
  command -v "$tool" >/dev/null || die "'$tool' is not installed"
done

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$here")"
remote="$DEPLOY_HOST:$DEPLOY_DIR"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# --- The check of the public addresses (step 4, and --check) -----------------

# fetch URL: sets $status (000 without an answer) and $location (the Location
# header, empty without one). Redirects are not followed.
fetch() {
  : > "$tmp/headers"
  status="$(curl -s -o /dev/null -D "$tmp/headers" -w '%{http_code}' --max-time 15 "$1" || true)"
  location="$(tr -d '\r' < "$tmp/headers" | awk 'tolower($1) == "location:" { print $2; exit }')"
}

# Traefik takes a moment to route a container that was just created, so each
# address gets a few tries. SITE_HOST must answer 200.
check_site() {
  local url="https://$SITE_HOST/"
  for _ in 1 2 3 4 5; do
    fetch "$url"
    [ "$status" = 200 ] && break
    sleep 2
  done
  echo "$url -> HTTP $status${location:+, Location: $location}"
  [ "$status" = 200 ] || { echo "   expected HTTP 200" >&2; return 1; }
}

# check_redirect HOST PATH: a former name must answer with a permanent redirect
# (301; 308 for methods other than GET) to the same path and query on SITE_HOST.
check_redirect() {
  local url="https://$1$2" want="https://$SITE_HOST$2"
  for _ in 1 2 3 4 5; do
    fetch "$url"
    case "$status" in 301|308) [ "$location" = "$want" ] && break ;; esac
    sleep 2
  done
  echo "$url -> HTTP $status${location:+, Location: $location}"
  case "$status" in
    301|308) [ "$location" = "$want" ] || { echo "   expected Location: $want" >&2; return 1; } ;;
    *)       echo "   expected a permanent redirect (301) to $want" >&2; return 1 ;;
  esac
}

check_public() {
  local failed=0 host
  step "Checking the public addresses"
  check_site || failed=1
  # The site's own address, and a path with a query that must arrive unchanged.
  # The fragment (#...) of a shared link never reaches the server; the browser
  # keeps it across the redirect.
  for host in ${former[@]+"${former[@]}"}; do
    check_redirect "$host" "/" || failed=1
    check_redirect "$host" "/deploy-check/path?query=kept&t=$(date +%s)" || failed=1
  done
  [ "$failed" = 0 ]
}

if [ "$check_only" = 1 ]; then
  check_public || die "the public addresses do not answer as configured (see above)"
  exit 0
fi

# --- 1. What to upload ------------------------------------------------------

if [ "$placeholder" = 1 ]; then
  src="$here/placeholder"
  legal="Legal pages: NONE. The placeholder has no imprint and no privacy statement and asks search engines not to index it."
  countries="Countries: none. The placeholder is a single page without the app."
else
  command -v npm >/dev/null || die "'npm' is not installed, cannot build the app"
  step "Building the app (npm run build in $root)"
  # The build says in one line starting with "Countries:" which country packs it
  # contains and which it left out as previews, and in one starting with "Legal
  # pages:" whether the site has its imprint and privacy statement; keep a copy of
  # the output to find them.
  (cd "$root" && npm run build) 2>&1 | tee "$tmp/build.log" || die "the build failed; nothing was uploaded"
  countries="$(grep '^Countries:' "$tmp/build.log" | tail -n 1 || true)"
  legal="$(grep '^Legal pages:' "$tmp/build.log" | tail -n 1 || true)"
  src="$root/dist"
fi
[ -f "$src/index.html" ] || die "$src/index.html is missing; nothing was uploaded"

step "Countries, imprint and privacy statement"
banner "${countries:-Countries: UNKNOWN. The build did not say which country packs it contains; read the build output above.}

${legal:-Legal pages: UNKNOWN. The build did not say whether the site has an imprint and a privacy statement; read the build output above.}"

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

# docker compose reads its settings from a .env file next to docker-compose.yml,
# so compose commands typed on the server later see the same configuration.
# With former names, COMPOSE_FILE adds docker-compose.redirect.yml and
# SITE_REDIRECT_RULE names them; without, neither is there.
{
  echo "# Written by deploy.sh; read by docker compose in this directory."
  printf 'SITE_HOST=%s\n' "$SITE_HOST"
  if [ -n "$redirect_rule" ]; then
    printf 'COMPOSE_FILE=docker-compose.yml:docker-compose.redirect.yml\n'
    printf "SITE_REDIRECT_RULE='%s'\n" "$redirect_rule"
  fi
} > "$tmp/.env"

step "Routing (Traefik labels, from .env)"
echo "https://$SITE_HOST/  serves the site (router budget)"
if [ -n "$redirect_rule" ]; then
  for host in "${former[@]}"; do
    echo "https://$host/<path>?<query>  redirects permanently (301) to https://$SITE_HOST/<path>?<query> (router budget-redirect)"
  done
else
  echo "No former host names: no redirect, docker-compose.redirect.yml is not used."
fi
echo "-- .env"
sed 's/^/   /' "$tmp/.env"
echo "If rsync lists .env or a docker-compose file as changed below, docker compose up -d"
echo "recreates the container: the site is away for a few seconds (see deploy/README.md)."

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
upload --inplace "$here/docker-compose.yml" "$here/docker-compose.redirect.yml" "$here/nginx.conf" "$tmp/.env" "$remote/"

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
  step "Dry run finished. Skipped: creating the directory, docker compose up, nginx reload, check of the public addresses."
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

# --- 4. Check the public addresses -------------------------------------------

check_public || die "the public addresses do not answer as configured (see above). The files are uploaded and the container was started; check Traefik, DNS and the container logs, and see \"Former host names\" in deploy/README.md for going back."
