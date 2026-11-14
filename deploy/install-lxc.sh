#!/usr/bin/env bash
# Create an unprivileged Debian 12 LXC on a Proxmox host and install the Actual companion app in it.
# Run as root on the Proxmox node.
#   Install: ./install-lxc.sh [-i CTID] [-n hostname] [-s storage] [-t template-storage] [-b bridge]
#                             [-a dhcp|192.168.1.50/24,gw=192.168.1.1] [-m MB] [-d GB] [-v ACTUAL_API_VERSION]
#                             [-z app.zip | -u https://.../actual_companion.zip [-c sha256]]
#   Update : ./install-lxc.sh update CTID [-z app.zip | -u URL [-c sha256]] [-v ACTUAL_API_VERSION]   (keeps settings and data)
#   For a private repo, export DOWNLOAD_AUTH_HEADER='Authorization: Bearer <token>' before running with -u.
set -euo pipefail

CTID=""; HOSTNAME_CT="actual-companion"; STORAGE="local-lvm"; TMPL_STORE="local"; BRIDGE="vmbr0"
NETCFG="dhcp"; MEM=512; DISK=4; ZIP="./actual_companion.zip"; API_VER=""; MODE="install"; URL=""; SHA=""
CLEAN=(); trap 'rm -rf "${CLEAN[@]-}"' EXIT
APP_DIR=/opt/actual-companion; DATA_DIR=/var/lib/actual-companion; ENV_FILE=/etc/actual-companion.env

die() { echo "ERROR: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "'$1' not found - run this on the Proxmox host."; }

if [[ "${1:-}" == "update" ]]; then MODE="update"; shift; CTID="${1:-}"; [[ -n "$CTID" ]] || die "usage: $0 update CTID [-z app.zip]"; shift; fi
while getopts "i:n:s:t:b:a:m:d:z:u:c:v:h" o; do
  case "$o" in
    i) CTID=$OPTARG;; n) HOSTNAME_CT=$OPTARG;; s) STORAGE=$OPTARG;; t) TMPL_STORE=$OPTARG;; b) BRIDGE=$OPTARG;;
    a) NETCFG=$OPTARG;; m) MEM=$OPTARG;; d) DISK=$OPTARG;; z) ZIP=$OPTARG;; u) URL=$OPTARG;; c) SHA=$OPTARG;; v) API_VER=$OPTARG;;
    *) sed -n '2,8p' "$0"; exit 1;;
  esac
done

[[ $EUID -eq 0 ]] || die "run as root"
for c in pct pveam pvesm pvesh; do need "$c"; done
if [[ -n "$URL" ]]; then
  need curl; need sha256sum
  [[ "$URL" == https://* ]] || die "-u must be an https:// URL"
  ZIP=$(mktemp --suffix=.zip); CLEAN+=("$ZIP")
  echo "==> Downloading $URL"
  curl -fsSL ${DOWNLOAD_AUTH_HEADER:+-H "$DOWNLOAD_AUTH_HEADER"} -o "$ZIP" "$URL" || die "download failed"
  if [[ -n "$SHA" ]]; then echo "$SHA  $ZIP" | sha256sum -c - >/dev/null || die "checksum mismatch - not installing"; echo "    checksum OK"
  else echo "    sha256: $(sha256sum "$ZIP" | cut -d' ' -f1)  (pass -c <hash> to verify next time)"; fi
fi
[[ -f "$ZIP" ]] || die "app zip not found: $ZIP (use -z or -u)"
[[ "$(head -c2 "$ZIP")" == "PK" ]] || die "$ZIP is not a zip file"
[[ "$API_VER" =~ ^[0-9A-Za-z.\-]*$ ]] || die "bad -v value"
[[ "$HOSTNAME_CT" =~ ^[a-zA-Z0-9-]+$ ]] || die "bad hostname"
[[ "$MEM" =~ ^[0-9]+$ && "$DISK" =~ ^[0-9]+$ ]] || die "-m and -d must be numbers"

ct() { pct exec "$CTID" -- bash -c "$1"; }

push_and_install_app() {
  local tmp="/tmp/actual_companion.zip"
  pct push "$CTID" "$ZIP" "$tmp"
  ct "set -e
      rm -rf ${APP_DIR}.new && mkdir -p ${APP_DIR}.new && unzip -q -o $tmp -d ${APP_DIR}.new && rm -f $tmp
      cd ${APP_DIR}.new && npm install --omit=dev --no-audit --no-fund"
  if [[ -n "$API_VER" ]]; then ct "cd ${APP_DIR}.new && npm install --omit=dev --no-save --no-audit --no-fund '@actual-app/api@${API_VER}'"; fi
  ct "set -e
      rm -rf ${APP_DIR}.old; [ -d ${APP_DIR} ] && mv ${APP_DIR} ${APP_DIR}.old || true
      mv ${APP_DIR}.new ${APP_DIR} && chown -R root:root ${APP_DIR}
      rm -rf ${APP_DIR}.old"
}

if [[ "$MODE" == "update" ]]; then
  pct status "$CTID" | grep -q running || die "container $CTID is not running"
  push_and_install_app
  ct "systemctl restart actual-companion && sleep 2 && systemctl is-active actual-companion"
  echo "Updated container $CTID. Settings, env file and data were not touched."
  exit 0
fi

[[ -n "$CTID" ]] || CTID=$(pvesh get /cluster/nextid)
pct status "$CTID" >/dev/null 2>&1 && die "container $CTID already exists"
pvesm status | awk 'NR>1{print $1}' | grep -qx "$STORAGE" || die "storage '$STORAGE' not found (use -s). Available: $(pvesm status | awk 'NR>1{printf "%s ",$1}')"

echo "==> Debian 12 template"
pveam update >/dev/null
TEMPLATE=$(pveam available --section system | awk '/debian-12-standard/ {print $2}' | sort -V | tail -1)
[[ -n "$TEMPLATE" ]] || die "no debian-12-standard template found"
pveam list "$TMPL_STORE" | grep -q "$TEMPLATE" || pveam download "$TMPL_STORE" "$TEMPLATE"

NET="name=eth0,bridge=${BRIDGE},firewall=1"
if [[ "$NETCFG" == "dhcp" ]]; then NET+=",ip=dhcp"
else NET+=",ip=${NETCFG%%,gw=*}"; [[ "$NETCFG" == *",gw="* ]] && NET+=",gw=${NETCFG##*,gw=}"; fi

echo "==> Creating container $CTID ($HOSTNAME_CT)"
pct create "$CTID" "${TMPL_STORE}:vztmpl/${TEMPLATE}" --hostname "$HOSTNAME_CT" --ostype debian --unprivileged 1 \
  --cores 1 --memory "$MEM" --swap 256 --rootfs "${STORAGE}:${DISK}" --net0 "$NET" --onboot 1 --features nesting=0 \
  --description "Actual companion app"
pct start "$CTID"

echo "==> Waiting for network"
for i in $(seq 1 40); do ct "getent hosts deb.debian.org >/dev/null" 2>/dev/null && break; sleep 2; [[ $i -lt 40 ]] || die "container has no network/DNS"; done

echo "==> Installing Node.js 22 (NodeSource apt repository)"
ct "set -e; export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq curl ca-certificates gnupg unzip openssl build-essential python3
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    echo 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main' > /etc/apt/sources.list.d/nodesource.list
    apt-get update -qq && apt-get install -y -qq nodejs
    node -v"

echo "==> Installing the app"
ct "id companion >/dev/null 2>&1 || useradd --system --home-dir ${DATA_DIR} --shell /usr/sbin/nologin companion
    install -d -m 0700 -o companion -g companion ${DATA_DIR}"
push_and_install_app

WORK=$(mktemp -d); CLEAN+=("$WORK")
PASS=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | cut -c1-24)
cat > "$WORK/env" <<ENVEOF
APP_PASSWORD=${PASS}
ACTUAL_SERVER_URL=
ACTUAL_PASSWORD=
ACTUAL_SYNC_ID=
SIMPLEFIN_ACCESS_URL=
SNAPTRADE_CLIENT_ID=
SNAPTRADE_CONSUMER_KEY=
DATA_DIR=${DATA_DIR}
PORT=3000
ENVEOF
cat > "$WORK/unit" <<UNITEOF
[Unit]
Description=Actual companion app
After=network-online.target
Wants=network-online.target

[Service]
User=companion
Group=companion
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${DATA_DIR}

[Install]
WantedBy=multi-user.target
UNITEOF
pct push "$CTID" "$WORK/env" "$ENV_FILE" --perms 0600
pct push "$CTID" "$WORK/unit" /etc/systemd/system/actual-companion.service --perms 0644
ct "systemctl daemon-reload && systemctl enable --now actual-companion && sleep 2 && systemctl is-active actual-companion"

IP=$(ct "hostname -I | awk '{print \$1}'" 2>/dev/null || true)
cat <<DONE

Done. Container ${CTID} (${HOSTNAME_CT}) is running the app on port 3000${IP:+ at http://${IP}:3000}.

  Sign-in password (shown once, also in ${ENV_FILE} inside the container): ${PASS}

Next:
  1. Fill in your Actual and SimpleFIN details:   pct exec ${CTID} -- nano ${ENV_FILE}
     then restart:                                  pct exec ${CTID} -- systemctl restart actual-companion
  2. Check it:                                      pct exec ${CTID} -- journalctl -u actual-companion -n 30
  3. NPMplus: add a Proxy Host to http://${IP:-<container-ip>}:3000, request a certificate, force HTTPS,
     and attach an Access List that only allows your LAN.
  4. Upgrade later with a new zip:                  $0 update ${CTID} -z new.zip
DONE
