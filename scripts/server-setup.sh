#!/usr/bin/env bash
# Prepare a fresh Ubuntu 24.04 server (a small DigitalOcean Droplet) to run the shop. Run once, as root:
#
#   ssh root@<server> 'bash -s' < scripts/server-setup.sh
#
# Safe to run again. It adds swap, security updates, a firewall, Docker and a deploy user, and removes background
# programs a 1 GB server has no use for. It starts nothing of the shop and holds no secrets.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive
step() { printf '\n== %s\n' "$1"; }

step "waiting for the first boot to finish"
cloud-init status --wait >/dev/null 2>&1 || true

step "swap (2 GB), used only when memory runs short"
if ! swapon --show=NAME --noheadings | grep -q '^/swapfile$'; then
  [ -f /swapfile ] || { fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null; }
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
cat > /etc/sysctl.d/99-cambokb.conf <<'EOF'
# Keep programs in memory; move only what is really idle to swap.
vm.swappiness = 30
vm.vfs_cache_pressure = 50
EOF
sysctl -q --system

step "security updates, installed by themselves from now on"
apt-get -o DPkg::Lock::Timeout=300 update -q
apt-get -o DPkg::Lock::Timeout=300 -y -q upgrade
apt-get -o DPkg::Lock::Timeout=300 -y -q install unattended-upgrades ufw ca-certificates curl

step "removing what a Docker server does not need"
for p in snapd multipath-tools modemmanager packagekit udisks2; do
  if dpkg -s "$p" >/dev/null 2>&1; then apt-get -o DPkg::Lock::Timeout=300 -y -q purge "$p" || true; fi
done
apt-get -y -q autoremove --purge

step "firewall: SSH only (the shop is reached through the Cloudflare Tunnel, which connects outward)"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw limit 22/tcp >/dev/null
ufw --force enable >/dev/null

step "SSH: keys only"
cat > /etc/ssh/sshd_config.d/00-cambokb.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t && systemctl reload ssh

step "Docker"
command -v docker >/dev/null || { curl -fsSL https://get.docker.com -o /root/get-docker.sh; sh /root/get-docker.sh >/dev/null; rm /root/get-docker.sh; }
# No proxy process per published port, logs capped, and containers keep running while Docker itself is updated.
cat > /etc/docker/daemon.json <<'EOF'
{
  "userland-proxy": false,
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl enable -q docker
systemctl restart docker

step "deploy user and folder"
id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
install -m 600 -o deploy -g deploy /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
install -d -m 750 -o deploy -g deploy /opt/cambo-supply

step "done"
docker --version
docker compose version
ufw status | head -8
free -m
