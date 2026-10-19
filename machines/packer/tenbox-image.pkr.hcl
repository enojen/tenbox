# The tenbox machine image: one snapshot that every task machine and every CI runner boots
# from. Build it with machines/packer/build.sh; see machines/README.md.

packer {
  required_plugins {
    hcloud = {
      source  = "github.com/hetznercloud/hcloud"
      version = ">= 1.6.0"
    }
  }
}

variable "hcloud_token" {
  type      = string
  default   = env("HCLOUD_TOKEN")
  sensitive = true
}

variable "location" {
  type    = string
  default = "hel1"
}

# The server the image is built on; it lives only during the build.
variable "server_type" {
  type    = string
  default = "cx23"
}

variable "base_image" {
  type    = string
  default = "ubuntu-24.04"
}

# The branch of this repo that build.sh bundled, and the commit it was at.
variable "tenbox_branch" {
  type = string
}

variable "tenbox_ref" {
  type = string
}

# What `claude.ai/install.sh` installs: stable, latest or a version.
variable "claude_channel" {
  type    = string
  default = "stable"
}

locals {
  built = formatdate("YYYYMMDD-hhmm", timestamp())
}

source "hcloud" "tenbox" {
  token         = var.hcloud_token
  image         = var.base_image
  location      = var.location
  server_type   = var.server_type
  server_name   = "packer-tenbox-image-${local.built}"
  ssh_username  = "root"
  snapshot_name = "tenbox-image-${local.built}"
  snapshot_labels = {
    "tenbox-image" = "true"
    "tenbox-ref"   = var.tenbox_ref
    "built"        = local.built
  }
}

build {
  sources = ["source.hcloud.tenbox"]

  provisioner "shell" {
    inline = ["mkdir -p /tmp/watchdog"]
  }

  provisioner "file" {
    source      = ".build/tenbox.bundle"
    destination = "/tmp/tenbox.bundle"
  }

  provisioner "file" {
    source      = "../watchdog/"
    destination = "/tmp/watchdog"
  }

  provisioner "shell" {
    environment_vars = [
      "DEBIAN_FRONTEND=noninteractive",
      "TENBOX_BRANCH=${var.tenbox_branch}",
      "TENBOX_REF=${var.tenbox_ref}",
      "CLAUDE_CHANNEL=${var.claude_channel}",
      "BUILT=${local.built}",
    ]
    scripts = [
      "scripts/10-base.sh",
      "scripts/20-tools.sh",
      "scripts/30-tenbox.sh",
      "scripts/40-watchdog.sh",
      "scripts/90-cleanup.sh",
    ]
  }
}
