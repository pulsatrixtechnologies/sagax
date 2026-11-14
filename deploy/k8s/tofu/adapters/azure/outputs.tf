output "cluster_name" {
  value = one(azurerm_kubernetes_cluster.this[*].name)
}

output "disk_encryption_set_id" {
  description = "Pass this to the Helm value storage.parameters.diskEncryptionSetID."
  value       = one(azurerm_disk_encryption_set.this[*].id)
}

output "audit_storage_account_id" {
  value = one(azurerm_storage_account.audit[*].id)
}

output "entra_mfa_policy_id" {
  description = "Conditional Access policy the operator named as the MFA control."
  value       = var.entra_mfa_policy_id
}

output "sku_tier" {
  value = "Free"
}

output "sandbox_vm_size" {
  value = var.pool.azure_vm_size
}

output "api_server_fqdn" {
  description = "Set SAGAX_SANDBOX_K8S_DENY_HOSTS on the provisioner to this (sandboxes/adapters/azure/sandboxd-deny-hosts.yaml): the API's public address, which changes at each cluster start."
  value       = one(azurerm_kubernetes_cluster.this[*].fqdn)
}
