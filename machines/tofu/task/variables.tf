variable "task" {
  description = "The task id, e.g. TEN-301."
  type        = string
}

variable "project" {
  description = "The project name, the directory under ~/wt."
  type        = string
}

variable "repo" {
  description = "The project's GitHub clone URL, https."
  type        = string
}

variable "cmd" {
  description = "The tenbox command the machine runs after boot, in the project's main checkout."
  type        = string
  default     = ""
}

variable "up" {
  description = "True while the server should exist; the volume stays either way."
  type        = bool
  default     = true
}

variable "server_type" {
  description = "machine.sh tries cx33, cx43 and cx23 in order; hel1 runs out of some."
  type        = string
  default     = "cx33"
}

variable "location" {
  type    = string
  default = "hel1"
}

variable "volume_size" {
  description = "GB; Hetzner's minimum is 10."
  type        = number
  default     = 10
}

variable "ssh_keys" {
  description = "The names of the ssh keys in the Hetzner project that may log in as root: yours and the workflow's."
  type        = list(string)
  default     = ["tenzel", "tenbox-machine"]
}

variable "control" {
  description = "The GitHub repo whose machine.yml the watchdog calls for down."
  type        = string
  default     = "enojen/tenbox"
}

variable "ntfy" {
  description = "The ntfy URL for notifications, empty for none."
  type        = string
  default     = ""
}

variable "hcloud_token" {
  type      = string
  sensitive = true
}

variable "github_token" {
  description = "Reads and pushes the project and opens its PRs; given to gh on the machine."
  type        = string
  sensitive   = true
}

variable "claude_credentials" {
  description = "The contents of ~/.claude/.credentials.json; Remote Control needs a claude.ai login."
  type        = string
  sensitive   = true
}

variable "tracker_api_key" {
  description = "tracker.api_key for the project's tenbox.local.yaml on the machine; empty for none."
  type        = string
  sensitive   = true
  default     = ""
}
