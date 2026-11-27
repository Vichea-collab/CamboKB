terraform {
  required_version = ">= 1.5.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.109.0"
    }
  }
}

# Authentication comes from DIGITALOCEAN_TOKEN in the caller's environment.
provider "digitalocean" {}

resource "digitalocean_droplet" "shop" {
  name     = var.droplet_name
  region   = var.region
  size     = var.droplet_size
  image    = var.droplet_image
  backups  = var.enable_backups
  ipv6     = var.enable_ipv6
  ssh_keys = var.ssh_key_fingerprints

  lifecycle {
    prevent_destroy = true
    # DigitalOcean only uses these at creation; manage access to an existing host through SSH.
    ignore_changes = [ssh_keys]
  }
}

resource "digitalocean_firewall" "shop" {
  name        = var.firewall_name
  droplet_ids = [digitalocean_droplet.shop.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.ssh_source_cidrs
  }

  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}
