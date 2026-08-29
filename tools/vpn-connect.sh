#!/usr/bin/env bash
#
# Bring up a split-tunnel OpenVPN connection to the home NAS from a Cloud Agent VM.
#
# This script is intentionally NON-SENSITIVE and safe to commit: all secrets are
# read from the environment (injected via the Cursor Secrets panel at VM boot).
#
# Required secrets (Secrets panel):
#   OPENVPN_CONFIG          Full .ovpn profile contents (inline ca/cert/key/tls-auth).
#   OPENVPN_AUTH_USERNAME   OpenVPN auth username.
#   OPENVPN_AUTH_PASSWORD   OpenVPN auth password.
#
# Optional overrides (env):
#   NAS_VPN_REMOTE_HOST     VPN endpoint host (default: a.markmahoro.top, via DDNS).
#   NAS_VPN_REMOTE_PORT     VPN endpoint port (default: 1194).
#   NAS_VPN_ROUTE_NET       LAN network to route via the tunnel (default: 192.168.12.0).
#   NAS_VPN_ROUTE_MASK      Netmask for that network      (default: 255.255.255.0).
#   NAS_VPN_DIR             Work dir for generated files  (default: $HOME/vpn).
#
# Safety: the profile's `redirect-gateway` (full-tunnel) is neutralized so the
# agent keeps its own connectivity to Cursor/GitHub; only the NAS subnet is
# routed through the VPN.
set -euo pipefail

REMOTE_HOST="${NAS_VPN_REMOTE_HOST:-a.markmahoro.top}"
REMOTE_PORT="${NAS_VPN_REMOTE_PORT:-1194}"
ROUTE_NET="${NAS_VPN_ROUTE_NET:-192.168.12.0}"
ROUTE_MASK="${NAS_VPN_ROUTE_MASK:-255.255.255.0}"
VPN_DIR="${NAS_VPN_DIR:-$HOME/vpn}"

CONF="$VPN_DIR/nas.ovpn"
CREDS="$VPN_DIR/creds.txt"
LOG="$VPN_DIR/openvpn.log"
PIDFILE="$VPN_DIR/openvpn.pid"

fail() { echo "ERROR: $*" >&2; exit 2; }

command -v openvpn >/dev/null 2>&1 || fail "openvpn client not installed (apt-get install -y openvpn)."
[[ -e /dev/net/tun ]] || fail "/dev/net/tun is missing; TUN not available on this VM."
[[ -n "${OPENVPN_CONFIG:-}" ]]        || fail "OPENVPN_CONFIG secret is not set."
[[ -n "${OPENVPN_AUTH_USERNAME:-}" ]] || fail "OPENVPN_AUTH_USERNAME secret is not set."
[[ -n "${OPENVPN_AUTH_PASSWORD:-}" ]] || fail "OPENVPN_AUTH_PASSWORD secret is not set."

umask 077
mkdir -p "$VPN_DIR"

# 1) Materialize the raw profile from the secret.
printf '%s\n' "$OPENVPN_CONFIG" > "$CONF.raw"

# 2) Transform into a split-tunnel profile pointing at the DDNS endpoint.
#    - force the remote line to the DDNS host/port
#    - comment out redirect-gateway (full tunnel)
#    - point auth-user-pass at our creds file
#    - drop any inline auth-user-pass filename we don't control
awk -v host="$REMOTE_HOST" -v port="$REMOTE_PORT" -v creds="$CREDS" '
  /^[[:space:]]*remote[[:space:]]/        { print "remote " host " " port; next }
  /^[[:space:]]*redirect-gateway/         { print "# " $0 " (disabled: split-tunnel)"; next }
  /^[[:space:]]*auth-user-pass/           { print "auth-user-pass " creds; next }
  { print }
' "$CONF.raw" > "$CONF"

# 3) Ensure split-tunnel routing directives are present exactly once.
grep -q '^route-nopull' "$CONF" || echo 'route-nopull' >> "$CONF"
grep -q "^route ${ROUTE_NET} ${ROUTE_MASK}" "$CONF" || echo "route ${ROUTE_NET} ${ROUTE_MASK}" >> "$CONF"

chmod 600 "$CONF" "$CONF.raw"

# 4) Credentials file.
printf '%s\n%s\n' "$OPENVPN_AUTH_USERNAME" "$OPENVPN_AUTH_PASSWORD" > "$CREDS"
chmod 600 "$CREDS"

# 5) Clean any stale instance and start.
if [[ -f "$PIDFILE" ]]; then sudo kill "$(cat "$PIDFILE")" 2>/dev/null || true; sleep 1; fi
: > "$LOG"

echo "Starting OpenVPN -> ${REMOTE_HOST}:${REMOTE_PORT} (split-tunnel: ${ROUTE_NET}/${ROUTE_MASK} via VPN)..."
sudo openvpn --config "$CONF" --writepid "$PIDFILE" --log "$LOG" --daemon

# 6) Wait for the tunnel.
for i in $(seq 1 40); do
  if grep -q "Initialization Sequence Completed" "$LOG" 2>/dev/null; then
    echo "VPN UP after ${i}s."
    echo "=== tun interface ==="; ip -brief addr show type tun || true
    echo "=== route to NAS ===";  ip route get "${ROUTE_NET%.*}.230" 2>/dev/null || true
    exit 0
  fi
  if grep -qiE "AUTH_FAILED|TLS Error|Connection refused|Cannot resolve|Exiting due to fatal error" "$LOG" 2>/dev/null; then
    echo "VPN failed to connect. Recent log:" >&2; tail -n 30 "$LOG" >&2; exit 3
  fi
  sleep 1
done

echo "VPN did not initialize within 40s. Recent log:" >&2; tail -n 30 "$LOG" >&2; exit 4
