// Visible roles (2026-11-05): a ConnectWise permission in words, for the
// banner of a refused call, a routine's role coverage and the tooltip of a
// refused permission in Details > Permissions:
// "Service Desk › Service Tickets (service/tickets) · Modifier".
import { t } from "@/lib/i18n";
import type { CwOperation, CwPermission } from "../../shared/perspicax-roles";

function operationLabel(operation: CwOperation): string {
  return t(operation === "Inquire" ? "roles.op.inquire" : operation === "Add" ? "roles.op.add" : operation === "Edit" ? "roles.op.edit" : "roles.op.delete");
}

function permissionArea(permission: CwPermission): string {
  return permission.module ? `${permission.module} › ${permission.func}` : permission.func;
}

export function permissionText(permission: CwPermission): string {
  return `${permissionArea(permission)}${permission.path ? ` (${permission.path})` : ""} · ${operationLabel(permission.operation)}`;
}
