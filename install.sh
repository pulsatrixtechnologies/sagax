#!/usr/bin/env bash
# Sagax server: one-line self-hosted install (docs/install.md).
#
#   curl -fsSL https://raw.githubusercontent.com/pulsatrixtechnologies/Sagax/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/pulsatrixtechnologies/Sagax/main/install.sh | bash -s -- --domain bots.example.com
#
# What it does, and nothing more:
#   1. checks that Docker and Docker Compose are there and running;
#   2. writes a small install folder (default ~/sagax): .env (created once,
#      mode 0600, never overwritten), compose.yaml, Caddyfile and the `sagax`
#      helper (update, pair, logs, ...);
#   3. generates the server's secrets on this machine and never prints them;
#   4. pulls the public image ghcr.io/pulsatrixtechnologies/sagax at one exact
#      release, starts it, waits until it answers, and prints the address and
#      a one-time sign-in link.
#
# Run it again at any time: it keeps .env, the data volume and every setting,
# and refreshes the generated files. `--dry-run` prints the plan and writes
# nothing. The checkout path (git clone, docker compose up --build) is
# unchanged and documented in docs/self-hosting.md.
set -euo pipefail

REPO="pulsatrixtechnologies/Sagax"
IMAGE_DEFAULT="ghcr.io/pulsatrixtechnologies/sagax"
CADDY_IMAGE_DEFAULT="caddy:2"

dir="${SAGAX_DIR:-$HOME/sagax}"
domain=""
port="8080"
bind="127.0.0.1"
version=""
image="${SAGAX_IMAGE:-$IMAGE_DEFAULT}"
dry_run=0
start=1
link_helper=1
set_domain=0
set_port=0
set_bind=0
set_image=0

usage() {
  cat <<'USAGE'
Sagax server installer

  install.sh [--dir DIR] [--domain HOST] [--port N] [--bind ADDR]
             [--version X.Y.Z] [--image REF] [--no-start] [--no-link] [--dry-run]

  --dir DIR       install folder (default: $SAGAX_DIR or ~/sagax)
  --domain HOST   serve https://HOST with an automatic certificate (ports 80
                  and 443 must reach this machine; DNS must point here)
  --port N        without --domain: the HTTP port on this machine (default 8080)
  --bind ADDR     without --domain: the address that port listens on
                  (default 127.0.0.1; 0.0.0.0 opens it to the network, every
                  remote browser still signs in with a pairing link)
  --version X.Y.Z the Sagax release to run (default: the latest release)
  --image REF     another image repository (default ghcr.io/pulsatrixtechnologies/sagax)
  --no-start      write the files but do not pull or start
  --no-link       do not put the `sagax` helper on the PATH
  --dry-run       print what would happen; write and start nothing
USAGE
}

die() { printf 'sagax install: %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) [ $# -ge 2 ] || die "--dir needs a folder"; dir="$2"; shift 2 ;;
    --domain) [ $# -ge 2 ] || die "--domain needs a host name"; domain="$2"; set_domain=1; shift 2 ;;
    --port) [ $# -ge 2 ] || die "--port needs a number"; port="$2"; set_port=1; shift 2 ;;
    --bind) [ $# -ge 2 ] || die "--bind needs an address"; bind="$2"; set_bind=1; shift 2 ;;
    --version) [ $# -ge 2 ] || die "--version needs X.Y.Z"; version="${2#pulsa-v}"; version="${version#v}"; shift 2 ;;
    --image) [ $# -ge 2 ] || die "--image needs a repository"; image="$2"; set_image=1; shift 2 ;;
    --no-start) start=0; shift ;;
    --no-link) link_helper=0; shift ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

# A re-run keeps what .env says unless an option names something else.
env_file="$dir/.env"
existing_env=0
if [ -f "$env_file" ]; then
  existing_env=1
  from_env() { sed -n "s/^$1=//p" "$env_file" | tail -n 1; }
  [ "$set_domain" = 1 ] || domain=$(from_env SAGAX_DOMAIN)
  [ "$set_port" = 1 ] || port=$(from_env SAGAX_HTTP_PORT); port="${port:-8080}"
  [ "$set_bind" = 1 ] || bind=$(from_env SAGAX_BIND); bind="${bind:-127.0.0.1}"
  [ "$set_image" = 1 ] || image=$(from_env SAGAX_IMAGE); image="${image:-$IMAGE_DEFAULT}"
fi

case "$port" in ''|*[!0-9]*) die "--port must be a number" ;; esac
if [ -n "$domain" ]; then
  case "$domain" in *[!A-Za-z0-9.-]*|.*|*.) die "--domain must be a bare host name, like bots.example.com" ;; esac
fi
if [ -n "$version" ]; then
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "--version must look like 0.8.4"
fi

# --- Docker -----------------------------------------------------------------
docker_ok=0
compose=()
if command -v docker >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then
    compose=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    compose=(docker-compose)
  fi
  if docker info >/dev/null 2>&1; then docker_ok=1; fi
fi
if [ ${#compose[@]} -eq 0 ]; then
  if [ "$dry_run" = 1 ]; then
    say "dry run: Docker with Compose was not found (install Docker: https://docs.docker.com/get-docker/)"
    compose=(docker compose)
  else
    die "Docker with Compose is required. Install Docker (https://docs.docker.com/get-docker/), start it, then run this again."
  fi
elif [ "$docker_ok" = 0 ]; then
  if [ "$dry_run" = 1 ]; then
    say "dry run: Docker is installed but not running"
  else
    die "Docker is installed but not running (or this user may not use it). Start Docker, then run this again."
  fi
fi

# --- Release ----------------------------------------------------------------
latest_version() {
  local tag
  tag=$(curl -fsSL --max-time 15 "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
    | sed -n 's/.*"tag_name": *"pulsa-v\([0-9][0-9.]*\)".*/\1/p' | head -n 1) || true
  printf '%s' "$tag"
}
if [ -z "$version" ]; then
  version=$(latest_version)
  [ -n "$version" ] || die "could not read the latest Sagax release from GitHub; pass --version X.Y.Z"
fi

# --- Paths and existing state ------------------------------------------------
project="sagax"
existing_volume=0
if [ "$docker_ok" = 1 ] && docker volume inspect "${project}_data" >/dev/null 2>&1; then existing_volume=1; fi

if [ -n "$domain" ]; then
  public_url="https://$domain"
else
  case "$bind" in
    127.0.0.1|localhost|0.0.0.0) public_url="http://localhost:$port" ;;
    *) public_url="http://$bind:$port" ;;
  esac
fi

new_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    od -An -tx1 -N32 /dev/urandom | tr -d ' \n'
  fi
}

write_env() {
  # Created once. The vault key encrypts the sign-ins and credentials the
  # server keeps (server/mcp-oauth.ts). It lives here, outside the data
  # volume, so a copy of the volume alone does not open them. An existing
  # volume already has its own key file: no key is added for it.
  local key=""
  if [ "$existing_volume" = 0 ]; then key=$(new_secret); fi
  (
    umask 077
    {
      echo "# Sagax server settings, written by install.sh. Keep this file private"
      echo "# and back it up apart from the data volume: it holds the vault key."
      echo "SAGAX_IMAGE=$image"
      echo "SAGAX_VERSION=$version"
      echo "SAGAX_DOMAIN=$domain"
      echo "SAGAX_HTTP_PORT=$port"
      echo "SAGAX_BIND=$bind"
      echo "SAGAX_PUBLIC_URL=$public_url"
      echo "CADDY_IMAGE=$CADDY_IMAGE_DEFAULT"
      if [ -n "$key" ]; then echo "SAGAX_MCP_OAUTH_KEY=$key"; fi
    } > "$env_file"
  )
  chmod 600 "$env_file"
}

# Replace one KEY=value line of .env in place, keeping its mode.
set_env_value() {
  local key="$1" value="$2" tmp
  tmp=$(mktemp "$dir/.env.XXXXXX")
  awk -v k="$key" -v v="$value" 'BEGIN { done = 0 } index($0, k "=") == 1 { print k "=" v; done = 1; next } { print } END { if (!done) print k "=" v }' "$env_file" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$env_file"
}

write_compose() {
  local ports
  if [ -n "$domain" ]; then
    ports='      - "80:80"
      - "443:443"'
  else
    # shellcheck disable=SC2016 # written literally, expanded later by Compose, Caddy or the helper
    ports='      - "${SAGAX_BIND:-127.0.0.1}:${SAGAX_HTTP_PORT:-8080}:80"'
  fi
  cat > "$dir/compose.yaml" <<EOF
# Written by install.sh: run it again rather than editing this file. Put your
# own changes in compose.override.yaml next to it (Compose reads both).
#
# The server listens only on 127.0.0.1 inside its container (the loopback
# trust model is its sign-in model). Caddy shares its network namespace and is
# the only thing that listens outside.
name: $project
services:
  omb:
    image: \${SAGAX_IMAGE:-$IMAGE_DEFAULT}:\${SAGAX_VERSION:?set SAGAX_VERSION in .env}
    restart: unless-stopped
    # Graceful shutdown drains turns before the session registry closes.
    stop_grace_period: 30s
    # An init collects the bots' browser processes; Chrome needs shared memory.
    init: true
    shm_size: 512m
    env_file: .env
    environment:
      SAGAX_IMAGE: \${SAGAX_IMAGE:-$IMAGE_DEFAULT}:\${SAGAX_VERSION}
      OMB_PUBLIC_URL: \${SAGAX_PUBLIC_URL}
      OMB_WEBHOOK_PUBLIC_URL: \${SAGAX_PUBLIC_URL}
    volumes:
      - data:/data
    ports:
$ports
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://127.0.0.1:8799/api/health | grep -q openmausbot"]
      interval: 15s
      timeout: 5s
      start_period: 30s
      retries: 5
  caddy:
    image: \${CADDY_IMAGE:-$CADDY_IMAGE_DEFAULT}
    restart: unless-stopped
    network_mode: "service:omb"
    depends_on:
      omb:
        condition: service_healthy
    environment:
      SAGAX_DOMAIN: \${SAGAX_DOMAIN:-}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
volumes:
  data:
  caddy_data:
  caddy_config:
EOF
}

write_caddyfile() {
  local site
  # shellcheck disable=SC2016 # written literally, expanded later by Compose, Caddy or the helper
  if [ -n "$domain" ]; then site='{$SAGAX_DOMAIN}'; else site=':80'; fi
  cat > "$dir/Caddyfile" <<EOF
# Written by install.sh. The server's own pairing is the sign-in: a browser
# without a session sees the pair page and nothing else.
$site {
	encode zstd gzip
	# Webhooks carry their own per-hook secrets and need no session.
	handle /hooks/* {
		reverse_proxy 127.0.0.1:8800 {
			# Hold briefly while the upstream restarts (docs/zero-downtime-deploy.md).
			lb_try_duration 25s
			lb_try_interval 250ms
			fail_duration 10s
			unhealthy_status 502 503
			health_uri /healthz
			health_interval 2s
			health_timeout 1s
		}
	}
	handle {
		reverse_proxy 127.0.0.1:8799 {
			# Hold briefly while the upstream restarts (docs/zero-downtime-deploy.md).
			lb_try_duration 25s
			lb_try_interval 250ms
			fail_duration 10s
			unhealthy_status 502 503
			health_uri /healthz
			health_interval 2s
			health_timeout 1s
			# stream events as they arrive
			flush_interval -1
		}
	}
}
EOF
}

write_helper() {
  cat > "$dir/sagax" <<'HELPER'
#!/usr/bin/env bash
# The `sagax` helper of a Docker install (written by install.sh, docs/install.md).
#
#   sagax update [X.Y.Z]   run that release (default: the latest): pull the
#                          image, restart, wait until the server answers. The
#                          server applies its own data migrations when it starts.
#   sagax pair             print a new one-time sign-in link
#   sagax status | logs | start | stop | restart | version
#   sagax <command>        any other command runs the server CLI in the
#                          container (sagax sessions, sagax access list, ...)
set -euo pipefail
REPO="pulsatrixtechnologies/Sagax"
HELPER
  # shellcheck disable=SC2016 # written literally, expanded later by Compose, Caddy or the helper
  printf 'SAGAX_HOME="${SAGAX_DIR:-%s}"\n' "$dir" >> "$dir/sagax"
  cat >> "$dir/sagax" <<'HELPER'
cd "$SAGAX_HOME" || { echo "sagax: no install at $SAGAX_HOME (set SAGAX_DIR)" >&2; exit 1; }
[ -f .env ] || { echo "sagax: $SAGAX_HOME/.env is missing; run install.sh again" >&2; exit 1; }
if docker compose version >/dev/null 2>&1; then dc=(docker compose); else dc=(docker-compose); fi

env_value() { sed -n "s/^$1=//p" .env | tail -n 1; }

set_env_value() {
  local key="$1" value="$2" tmp
  tmp=$(mktemp ./.env.XXXXXX)
  awk -v k="$key" -v v="$value" 'BEGIN { done = 0 } index($0, k "=") == 1 { print k "=" v; done = 1; next } { print } END { if (!done) print k "=" v }' .env > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" .env
}

wait_healthy() {
  for _ in $(seq 1 90); do
    if "${dc[@]}" exec -T omb curl -sf http://127.0.0.1:8799/api/health 2>/dev/null | grep -q openmausbot; then return 0; fi
    sleep 2
  done
  return 1
}

latest_version() {
  curl -fsSL --max-time 15 "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
    | sed -n 's/.*"tag_name": *"pulsa-v\([0-9][0-9.]*\)".*/\1/p' | head -n 1
}

cmd="${1:-status}"
[ $# -gt 0 ] && shift
case "$cmd" in
  update|upgrade)
    dry=0
    target=""
    for arg in "$@"; do
      case "$arg" in
        --dry-run) dry=1 ;;
        *) target="${arg#pulsa-v}"; target="${target#v}" ;;
      esac
    done
    [ -n "$target" ] || target=$(latest_version || true)
    [ -n "$target" ] || { echo "sagax update: could not read the latest release; name one: sagax update X.Y.Z" >&2; exit 1; }
    [[ "$target" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "sagax update: $target is not a release number (X.Y.Z)" >&2; exit 1; }
    previous=$(env_value SAGAX_VERSION)
    image=$(env_value SAGAX_IMAGE)
    echo "Sagax ${previous:-?} -> $target (${image:-ghcr.io/pulsatrixtechnologies/sagax}:$target)"
    if [ "$dry" = 1 ]; then
      echo "dry run: would set SAGAX_VERSION=$target, pull, restart and wait until the server answers"
      exit 0
    fi
    set_env_value SAGAX_VERSION "$target"
    if ! "${dc[@]}" pull omb; then
      set_env_value SAGAX_VERSION "$previous"
      echo "sagax update: could not pull $target; still on $previous" >&2
      exit 1
    fi
    "${dc[@]}" up -d
    if wait_healthy; then
      echo "Sagax $target is running. Back to the previous release at any time: sagax update $previous"
    else
      echo "sagax update: the server did not answer after the restart. Look at: sagax logs" >&2
      echo "To go back: sagax update $previous" >&2
      exit 1
    fi
    ;;
  pair)
    "${dc[@]}" exec -T omb node dist-server/openmausbot.js pair "$@"
    ;;
  status)
    "${dc[@]}" ps
    "${dc[@]}" exec -T omb node dist-server/openmausbot.js status 2>/dev/null || true
    ;;
  logs) "${dc[@]}" logs --tail 200 "$@" ;;
  start) "${dc[@]}" up -d ;;
  stop) "${dc[@]}" stop ;;
  restart) "${dc[@]}" restart ;;
  version) echo "Sagax $(env_value SAGAX_VERSION)" ;;
  -h|--help|help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) "${dc[@]}" exec -T omb node dist-server/openmausbot.js "$cmd" "$@" ;;
esac
HELPER
  chmod 755 "$dir/sagax"
}

link_on_path() {
  local target="" existing
  existing=$(command -v sagax 2>/dev/null || true)
  if [ -n "$existing" ] && [ "$(cd "$(dirname "$existing")" && pwd -P)/$(basename "$existing")" != "$dir/sagax" ] && [ ! -L "$existing" ]; then
    say "A different \`sagax\` is already on your PATH ($existing); this install's helper is $dir/sagax"
    return 0
  fi
  if [ -w /usr/local/bin ]; then
    target=/usr/local/bin/sagax
  elif [ -d "$HOME/.local/bin" ]; then
    target="$HOME/.local/bin/sagax"
  fi
  if [ -n "$target" ]; then
    ln -sf "$dir/sagax" "$target"
    say "Helper: sagax (linked at $target)"
  else
    say "Helper: $dir/sagax (add $dir to your PATH to type just \`sagax\`)"
  fi
}

# --- Plan -------------------------------------------------------------------
say "Sagax $version -> $dir"
say "  image    $image:$version"
if [ -n "$domain" ]; then say "  address  https://$domain (ports 80 and 443)"; else say "  address  $public_url (listening on $bind:$port)"; fi
if [ "$existing_env" = 1 ]; then
  say "  settings $env_file is kept as it is"
elif [ "$existing_volume" = 1 ]; then
  say "  settings $env_file is created (the existing data volume keeps its own vault key)"
else
  say "  settings $env_file is created with a new vault key (generated here, never shown)"
fi

if [ "$dry_run" = 1 ]; then
  say ""
  say "dry run: would write $dir/.env (mode 0600, only if absent), $dir/compose.yaml, $dir/Caddyfile and $dir/sagax"
  if [ "$start" = 1 ]; then
    say "dry run: would run: ${compose[*]} pull && ${compose[*]} up -d, wait for /api/health, then print a sign-in link"
  fi
  exit 0
fi

mkdir -p "$dir"
chmod 700 "$dir"
if [ "$existing_env" = 0 ]; then
  write_env
else
  # A re-run moves the install to the release asked for (the latest by
  # default), like `sagax update`, and records any option it was given.
  set_env_value SAGAX_VERSION "$version"
  [ "$set_domain" = 1 ] && set_env_value SAGAX_DOMAIN "$domain"
  [ "$set_port" = 1 ] && set_env_value SAGAX_HTTP_PORT "$port"
  [ "$set_bind" = 1 ] && set_env_value SAGAX_BIND "$bind"
  [ "$set_image" = 1 ] && set_env_value SAGAX_IMAGE "$image"
  if [ "$set_domain" = 1 ] || [ "$set_port" = 1 ] || [ "$set_bind" = 1 ]; then
    set_env_value SAGAX_PUBLIC_URL "$public_url"
  fi
fi
write_compose
write_caddyfile
write_helper
[ "$link_helper" = 1 ] && link_on_path

if [ "$start" = 0 ]; then
  say "Files written. Start with: cd $dir && ${compose[*]} up -d"
  exit 0
fi

cd "$dir"
"${compose[@]}" pull
"${compose[@]}" up -d
say "Waiting for the server to answer..."
healthy=0
for _ in $(seq 1 90); do
  if "${compose[@]}" exec -T omb curl -sf http://127.0.0.1:8799/api/health 2>/dev/null | grep -q openmausbot; then healthy=1; break; fi
  sleep 2
done
if [ "$healthy" = 0 ]; then
  die "the server did not answer within 3 minutes. Look at: cd $dir && ${compose[*]} logs omb"
fi

say ""
say "Sagax is running at $public_url"
say "Sign in from your browser with this one-time link (it expires; \`sagax pair\` makes another):"
"${compose[@]}" exec -T omb node dist-server/openmausbot.js pair --label "first device" || say "Run \`sagax pair\` for a sign-in link."
say ""
say "Next: sign the AI engines in from Settings > Engines, no terminal needed."
say "Update later with: sagax update"
