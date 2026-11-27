variable "droplet_name" {
  description = "DigitalOcean Droplet name."
  type        = string
  default     = "cambo-supply"
}

variable "droplet_size" {
  description = "DigitalOcean size slug."
  type        = string
  default     = "s-1vcpu-1gb"
}

variable "droplet_image" {
  description = "DigitalOcean image slug or ID."
  type        = string
  default     = "ubuntu-24-04-x64"
}

variable "region" {
  description = "DigitalOcean region slug."
  type        = string
  default     = "sgp1"
}

variable "enable_backups" {
  description = "Enable billable DigitalOcean Droplet backups."
  type        = bool
  default     = false
}

variable "enable_ipv6" {
  description = "Enable public IPv6 on the Droplet."
  type        = bool
  default     = false
}

variable "ssh_key_fingerprints" {
  description = "Fingerprints of SSH keys already registered in DigitalOcean, used when creating the Droplet."
  type        = set(string)

  validation {
    condition = length(var.ssh_key_fingerprints) > 0 && alltrue([
      for fingerprint in var.ssh_key_fingerprints : can(regex("^([0-9a-fA-F]{2}:){15}[0-9a-fA-F]{2}$", fingerprint))
    ])
    error_message = "Supply at least one colon-separated DigitalOcean SSH key fingerprint."
  }
}

variable "firewall_name" {
  description = "DigitalOcean Cloud Firewall name."
  type        = string
  default     = "cambo-supply-tunnel"
}

variable "ssh_source_cidrs" {
  description = "CIDRs allowed to SSH to the Droplet, including the Jenkins agent's public egress IP."
  type        = set(string)

  validation {
    condition = length(var.ssh_source_cidrs) > 0 && alltrue([
      for cidr in var.ssh_source_cidrs : can(cidrhost(cidr, 0)) && try(tonumber(split("/", cidr)[1]) > 0, false)
    ])
    error_message = "Supply valid SSH source CIDRs restricted to administrator and deployment networks."
  }
}
