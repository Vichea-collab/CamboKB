output "droplet_id" {
  description = "DigitalOcean Droplet ID."
  value       = digitalocean_droplet.shop.id
}

output "droplet_ipv4" {
  description = "Public IPv4 address for SSH and the Jenkins DEPLOY_HOST parameter."
  value       = digitalocean_droplet.shop.ipv4_address
}

output "firewall_id" {
  description = "DigitalOcean Cloud Firewall ID."
  value       = digitalocean_firewall.shop.id
}
