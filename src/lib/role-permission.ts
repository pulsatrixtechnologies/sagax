// Visible roles (2026-11-05): a ConnectWise permission in words, for the
// banner of a refused call and the bot's "Permissions manquantes" list:
// "Service Desk › Service Tickets (service/tickets) · Modifier".
import { t } from "@/lib/i18n";
import type { CwOperation, CwPermission } from "../../shared/perspicax-roles";

export function operationLabel(operation: CwOperation): string {
  return t(operation === "Inquire" ? "roles.op.inquire" : operation === "Add" ? "roles.op.add" : operation === "Edit" ? "roles.op.edit" : "roles.op.delete");
}

export function permissionArea(permission: CwPermission): string {
  return permission.module ? `${permission.module} › ${permission.func}` : permission.func;
}

export function permissionText(permission: CwPermission): string {
  return `${permissionArea(permission)}${permission.path ? ` (${permission.path})` : ""} · ${operationLabel(permission.operation)}`;
}
