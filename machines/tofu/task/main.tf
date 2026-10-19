# One Tenbox task on Hetzner Cloud: a volume that lives from start to close and a server
# that exists only while `up` is true. See machines/README.md and docs/design.md "Machines".

terraform {
  required_version = ">= 1.8"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.50"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

locals {
  # Hetzner names are host names: lower case, no underscore.
  slug   = lower(replace(var.task, "_", "-"))
  labels = { tenbox = "task", task = var.task, project = var.project }
}

# The newest image built by machines/packer.
data "hcloud_image" "tenbox" {
  with_selector     = "tenbox-image=true"
  with_architecture = "x86"
  most_recent       = true
}

data "hcloud_ssh_key" "me" {
  name = var.ssh_key
}

resource "hcloud_volume" "task" {
  name     = "tenbox-${local.slug}"
  size     = var.volume_size
  location = var.location
  format   = "ext4"
  labels   = local.labels
}

resource "hcloud_server" "task" {
  count       = var.up ? 1 : 0
  name        = "tenbox-${local.slug}"
  image       = data.hcloud_image.tenbox.id
  server_type = var.server_type
  location    = var.location
  ssh_keys    = [data.hcloud_ssh_key.me.id]
  labels      = local.labels
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    machine = jsonencode({
      task      = var.task
      project   = var.project
      repo      = var.repo
      volume    = hcloud_volume.task.id
      cmd       = var.cmd
      ntfy      = var.ntfy
      git_name  = var.git_name
      git_email = var.git_email
    })
    github_token       = var.github_token
    claude_credentials = var.claude_credentials
    boot               = file("${path.module}/tenbox-boot.sh")
  })
}

resource "hcloud_volume_attachment" "task" {
  count     = var.up ? 1 : 0
  volume_id = hcloud_volume.task.id
  server_id = hcloud_server.task[0].id
  automount = false
}

output "server" {
  value = var.up ? { id = hcloud_server.task[0].id, ip = hcloud_server.task[0].ipv4_address } : null
}

output "volume" {
  value = { id = hcloud_volume.task.id, name = hcloud_volume.task.name }
}

output "image" {
  value = { id = data.hcloud_image.tenbox.id, name = data.hcloud_image.tenbox.name }
}
