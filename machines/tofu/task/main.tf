# One Tenbox task on Hetzner Cloud: a volume that lives from start to close and a server
# that exists only while `up` is true. See machines/README.md and docs/design.md "Machines".

terraform {
  required_version = ">= 1.8"
  # The state of one task, tasks/<task>.tfstate in the bucket: machine.sh passes the bucket
  # and the key at init; the endpoint and the keys come from the AWS_* variables.
  backend "s3" {
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
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

data "hcloud_ssh_key" "keys" {
  for_each = toset(var.ssh_keys)
  name     = each.value
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
  ssh_keys    = [for key in data.hcloud_ssh_key.keys : key.id]
  labels      = local.labels
  # A plain delete is a power cut: what the volume got in the last half minute is lost.
  shutdown_before_deletion = true
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    machine = jsonencode({
      task    = var.task
      project = var.project
      repo    = var.repo
      volume  = hcloud_volume.task.id
      cmd     = var.cmd
      ntfy    = var.ntfy
      control = var.control
    })
    github_token       = var.github_token
    claude_credentials = var.claude_credentials
    tracker_api_key    = var.tracker_api_key
    boot               = file("${path.module}/tenbox-boot.sh")
    watchdog           = file("${path.module}/../../watchdog/tenbox-watchdog.sh")
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
