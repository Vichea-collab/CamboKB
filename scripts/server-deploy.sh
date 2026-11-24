#!/usr/bin/env bash
# Updates the shop on its server to one commit of main, checks it, and goes back by itself if a check fails.
#
# Installed on the server as /usr/local/bin/cambo-deploy (owned by root) and started by GitHub Actions over SSH. The
# key GitHub holds is tied to this program in ~deploy/.ssh/authorized_keys, so all it can do is ask for this:
#
#   restrict,command="/usr/local/bin/cambo-deploy" ssh-ed25519 AAAA... github-deploy
#
# The request is "deploy <40-character commit>". By hand on the server:  cambo-deploy deploy <commit>
# To go back, deploy an older commit of main (its images must still be in the registry). A database migration is not
# undone: the databases are backed up first, and migrations should keep the previous version working.
set -uo pipefail

APP="${CAMBO_APP:-/opt/cambo-supply}"
REPO="${CAMBO_REPO:-Vichea-collab/CamboKB}"
WAIT="${CAMBO_WAIT:-240}"
FILES=(docker-compose.prod.yml docker-compose.small.yml docker/postgres observability scripts/backup.sh)
umask 022 # containers read these files as other users; settings and backups are kept private below

say() { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { say "FAILED: $*"; exit 1; }

# ---- the request: nothing but a full commit id gets through ---------------------------------------------------
request="${SSH_ORIGINAL_COMMAND:-$*}"
[[ "$request" =~ ^deploy\ ([0-9a-f]{40})$ ]] || die 'only "deploy <commit>" is allowed'
sha="${BASH_REMATCH[1]}"
tag="sha-${sha:0:7}"

cd "$APP" || die "$APP is missing"
exec 9> .deploy.lock
flock -w 900 9 || die "another deploy is still running"

work=$(mktemp -d) || die "no temporary folder"
trap 'rm -rf "$work"' EXIT

current() { sed -n 's/^IMAGE_TAG=//p' .env.production | tail -1; }
compose() { # the files of the folder given first, with the image tag given second
  local dir=$1 t=$2; shift 2
  IMAGE_TAG=$t COMPOSE_PROFILES=tunnel,cloud docker compose --project-directory "$APP" \
    -f "$dir/docker-compose.prod.yml" -f "$dir/docker-compose.small.yml" --env-file .env.production "$@" < /dev/null
}
old=$(current)
[ -n "$old" ] || die "IMAGE_TAG is not set in .env.production"
say "now running $old, asked for $tag"

# ---- is the commit really part of main? -----------------------------------------------------------------------
# GitHub also serves commits of forks under this repository's address, so the id alone proves nothing.
status=$(curl -fsS --max-time 30 "https://api.github.com/repos/$REPO/compare/$sha...main" | sed -n 's/^  "status": "\([a-z]*\)",$/\1/p' | head -1)
case "$status" in ahead | identical) ;; *) die "commit $sha is not part of main" ;; esac

# ---- fetch and check everything before touching what runs -----------------------------------------------------
curl -fsSL --max-time 120 "https://codeload.github.com/$REPO/tar.gz/$sha" -o "$work/src.tar.gz" || die "cannot download the commit"
mkdir "$work/new" && tar -xzf "$work/src.tar.gz" -C "$work/new" --strip-components=1 --no-same-owner || die "bad download"
for f in "${FILES[@]}"; do [ -e "$work/new/$f" ] || die "the commit has no $f"; done
compose "$work/new" "$tag" config -q || die "the Compose files are not valid with this server's settings"
compose "$work/new" "$tag" pull -q || die "the images $tag cannot be pulled"
say "images pulled"

(umask 077; COMPOSE_CMD=./shop scripts/backup.sh < /dev/null) > "$work/backup.log" 2>&1 || { tail -3 "$work/backup.log"; die "backup"; }
say "backup made"

# ---- switch ---------------------------------------------------------------------------------------------------
install_files() { # from a folder, over the current files (in place: Docker mounts them by inode)
  local f
  for f in "${FILES[@]}"; do mkdir -p "$(dirname "$f")" && cp -R "$1/$f" "$(dirname "$f")/" || return 1; done
}
set_tag() {
  sed "s/^IMAGE_TAG=.*/IMAGE_TAG=$1/" .env.production > "$work/env" && cat "$work/env" > .env.production && rm -f "$work/env"
}
save() {
  mkdir -p "$work/old" || return 1
  local f
  for f in "${FILES[@]}"; do [ -e "$f" ] || continue; mkdir -p "$work/old/$(dirname "$f")" && cp -R "$f" "$work/old/$(dirname "$f")/" || return 1; done
}
start() { # tag
  compose "$APP" "$1" up -d --pull never --remove-orphans --wait --wait-timeout "$WAIT" > "$work/up.log" 2>&1 || { tail -3 "$work/up.log"; return 1; }
  # A changed configuration file does not restart the container that reads it.
  if ! cmp -s "$work/old/observability/alloy/cloud.alloy" "$work/new/observability/alloy/cloud.alloy"; then compose "$APP" "$1" restart alloy > /dev/null 2>&1; fi
}
get() { compose "$APP" "$(current)" exec -T api wget -qO- -T 15 "$@" 2> /dev/null; }
status_of() { compose "$APP" "$(current)" exec -T api wget -S -qO /dev/null -T 15 "$@" 2>&1 | sed -n 's/^ *HTTP\/[0-9.]* \([0-9]*\).*/\1/p' | tail -1; }

check() {
  local page photo s origin
  page=$(get http://web/) && [[ "$page" == *'<div id="root">'* ]] || { say "check: the home page does not answer"; return 1; }
  page=$(get 'http://web/api/v1/products') && [[ "$page" == *'"items":'* ]] || { say "check: the products do not answer"; return 1; }
  photo=$(printf '%s' "$page" | grep -oE '/files/[^"]*' | head -1)
  if [ -n "$photo" ]; then [ "$(status_of "http://web$photo")" = 200 ] || { say "check: a product photo does not load"; return 1; }; fi
  for s in api:4000 file:4100 report:4200 notification:4300; do
    get "http://$s/readyz" > /dev/null || { say "check: ${s%:*} is not ready"; return 1; }
  done
  [ "$(status_of --post-data='{}' http://web/telegram/webhook)" = 401 ] || { say "check: the Telegram route does not reach notification"; return 1; }
  origin=$(sed -n 's/^PUBLIC_ORIGIN=//p' .env.production | tail -1)
  curl -fsS --max-time 20 --retry 6 --retry-delay 5 --retry-all-errors -o /dev/null "$origin/api/v1/products?pageSize=1" || { say "check: $origin does not answer"; return 1; }
}

save || die "cannot keep a copy of the current files"
if install_files "$work/new" && set_tag "$tag" && start "$tag" && check; then
  # Keep this version and the one before it; older images only fill the disk.
  docker images --format '{{.Repository}}:{{.Tag}}' | grep -E "/cambokb-(api|file|report|notification|web):sha-" | grep -vE ":($tag|$old)\$" | xargs -r docker rmi > /dev/null 2>&1
  docker image prune -f > /dev/null 2>&1
  say "OK: the shop runs $tag (was $old)"
  exit 0
fi

# ---- back to the previous version ------------------------------------------------------------------------------
say "going back to $old"
if install_files "$work/old" && set_tag "$old" && start "$old" && check; then
  die "$tag did not pass, the shop is back on $old"
fi
die "$tag did not pass AND going back to $old did not work: log in to the server"
