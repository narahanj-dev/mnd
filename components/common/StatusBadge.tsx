import { EVENT_STATUS_LABELS } from "@/lib/constants";
import type { EventStatus } from "@/types";

const styles: Record<EventStatus, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
  cancellation_requested: "bg-orange-100 text-orange-800",
  cancelled: "bg-slate-200 text-slate-700",
};

export function StatusBadge({ status }: { status: EventStatus }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${styles[status]}`}>{EVENT_STATUS_LABELS[status]}</span>;
}
