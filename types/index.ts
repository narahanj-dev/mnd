export type UserRole = "user" | "admin";
export type AccountStatus = "active" | "inactive" | "pending";
export type EventType = "leave" | "outing" | "schedule" | "anniversary";
export type EventStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancellation_requested"
  | "cancelled";
export type RequestStatus = "pending" | "approved" | "rejected";
export type EventChangeType = "update" | "delete";

export interface Profile {
  id: string;
  login_id: string;
  display_name: string;
  department: string;
  role: UserRole;
  account_status: AccountStatus;
  must_change_password: boolean;
  birth_date: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface CalendarEvent {
  id: string;
  user_id: string;
  event_type: EventType;
  title: string;
  start_date: string;
  end_date: string;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  description: string | null;
  public_note: string | null;
  admin_note?: string | null;
  status: EventStatus;
  rejection_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  is_system_generated?: boolean;
  profile?: Pick<Profile, "display_name" | "department">;
}

export interface EventChangeRequest {
  id: string;
  event_id: string;
  requester_id: string;
  request_type: EventChangeType;
  reason: string;
  proposed_event_type: EventType | null;
  proposed_title: string | null;
  proposed_start_date: string | null;
  proposed_end_date: string | null;
  proposed_all_day: boolean | null;
  proposed_start_time: string | null;
  proposed_end_time: string | null;
  proposed_description: string | null;
  proposed_public_note: string | null;
  proposed_admin_note: string | null;
  status: RequestStatus;
  rejection_reason: string | null;
  processed_by: string | null;
  processed_at: string | null;
  created_at: string;
  event?: CalendarEvent;
  requester?: Pick<Profile, "display_name" | "department">;
}

export interface Message {
  id: string;
  sender_id: string | null;
  recipient_id: string;
  related_event_id: string | null;
  title: string;
  content: string;
  message_type: string;
  is_read: boolean;
  is_archived: boolean;
  created_at: string;
  read_at: string | null;
  sender?: Pick<Profile, "display_name"> | null;
}
