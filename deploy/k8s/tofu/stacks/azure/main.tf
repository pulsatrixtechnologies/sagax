module "core" {
  source = "../../core"

  name          = var.name
  azure_vm_size = var.azure_vm_size
}

module "azure" {
  source = "../../adapters/azure"

  enabled                         = var.enabled
  production                      = var.production
  name                            = module.core.name
  location                        = var.location
  system_vm_size                  = var.system_vm_size
  admin_group_object_ids          = var.admin_group_object_ids
  entra_mfa_policy_id             = var.entra_mfa_policy_id
  lock_audit_immutability         = var.lock_audit_immutability
  api_server_authorized_ip_ranges = var.api_server_authorized_ip_ranges
  audit_storage_account_name      = var.audit_storage_account_name
  key_vault_name                  = var.key_vault_name
  pool = {
    azure_vm_size    = module.core.sandbox_pool.azure_vm_size
    max_nodes        = module.core.sandbox_pool.max_nodes
    warm_nodes_night = module.core.sandbox_pool.warm_nodes_night
    labels           = module.core.sandbox_pool.labels
    taint            = module.core.sandbox_pool.taint
  }
  security = {
    audit_retention_days = module.core.security.audit_retention_days
    encryption_at_rest   = module.core.security.encryption_at_rest
    mfa_required         = module.core.security.mfa_required
    named_admins_only    = module.core.security.named_admins_only
    shared_admin         = module.core.security.shared_admin
  }
}

output "disk_encryption_set_id" {
  value = module.azure.disk_encryption_set_id
}

output "sku_tier" {
  value = module.azure.sku_tier
}

output "sandbox_vm_size" {
  value = module.azure.sandbox_vm_size
}

output "api_server_fqdn" {
  value = module.azure.api_server_fqdn
}
