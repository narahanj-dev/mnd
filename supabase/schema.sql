-- Supabase SQL Editor에서 이 파일을 먼저 실행하세요.
create extension if not exists pgcrypto;

create type public.user_role as enum ('user', 'department_admin', 'admin');
create type public.account_status as enum ('active', 'inactive', 'pending');
create type public.event_type as enum ('leave', 'overnight', 'weekend_outing', 'weekday_outing', 'anniversary');
create type public.event_status as enum ('pending', 'approved', 'rejected', 'cancellation_requested', 'cancelled');
create type public.request_status as enum ('pending', 'approved', 'rejected');
create type public.event_change_type as enum ('update', 'delete');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login_id text not null, -- AES-256-GCM 암호문
  login_id_hash text not null unique, -- 검색/중복검사용 HMAC
  display_name text not null, -- AES-256-GCM 암호문
  department text not null default '미지정',
  role public.user_role not null default 'user',
  account_status public.account_status not null default 'active',
  must_change_password boolean not null default false,
  birth_month_day text, -- MM-DD AES-256-GCM 암호문
  password_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table public.signup_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null, -- AES-256-GCM 암호문
  department text not null,
  birth_month_day text not null, -- MM-DD AES-256-GCM 암호문
  requested_login_id text not null, -- AES-256-GCM 암호문
  requested_login_id_hash text not null,
  requested_password text not null, -- 승인 전까지만 보관하는 AES-256-GCM 암호문
  reason text, -- AES-256-GCM 암호문
  status public.request_status not null default 'pending',
  rejection_reason text,
  processed_by uuid references public.profiles(id) on delete set null,
  approved_user_id uuid references public.profiles(id) on delete cascade,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type public.event_type not null,
  title text not null check (char_length(title) between 1 and 100),
  start_date date not null,
  end_date date not null,
  all_day boolean not null default true,
  start_time time,
  end_time time,
  description text,
  public_note text,
  admin_note text,
  status public.event_status not null default 'pending',
  rejection_reason text,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_event_dates check (end_date >= start_date),
  constraint valid_event_times check (all_day or (start_time is not null and end_time is not null and end_time > start_time))
);


create table public.event_change_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  request_type public.event_change_type not null,
  reason text not null check (char_length(reason) between 1 and 1000),
  proposed_event_type public.event_type,
  proposed_title text check (proposed_title is null or char_length(proposed_title) between 1 and 100),
  proposed_start_date date,
  proposed_end_date date,
  proposed_all_day boolean,
  proposed_start_time time,
  proposed_end_time time,
  proposed_description text,
  proposed_public_note text,
  proposed_admin_note text,
  status public.request_status not null default 'pending',
  rejection_reason text,
  processed_by uuid references public.profiles(id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint valid_proposed_dates check (
    request_type = 'delete' or (proposed_start_date is not null and proposed_end_date is not null and proposed_end_date >= proposed_start_date)
  ),
  constraint valid_proposed_times check (
    request_type = 'delete' or proposed_all_day = true or
    (proposed_start_time is not null and proposed_end_time is not null and proposed_end_time > proposed_start_time)
  )
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  related_event_id uuid references public.calendar_events(id) on delete cascade,
  title text not null,
  content text not null,
  message_type text not null default 'system',
  is_read boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create or replace function public.delete_expired_unarchived_messages()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count bigint;
begin
  delete from public.messages
  where is_archived = false
    and created_at < now() - interval '15 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.delete_expired_unarchived_messages() from public;

create table public.password_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  password_fingerprint text not null,
  created_at timestamptz not null default now()
);

create table public.admin_settings (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null unique references public.profiles(id) on delete cascade,
  display_name text not null default '관리자',
  updated_at timestamptz not null default now()
);

create index calendar_events_date_idx on public.calendar_events(start_date, end_date);
create index calendar_events_status_idx on public.calendar_events(status);
create index calendar_events_user_idx on public.calendar_events(user_id);
create index event_change_requests_event_idx on public.event_change_requests(event_id, status);
create index event_change_requests_requester_idx on public.event_change_requests(requester_id, created_at desc);
create unique index event_change_requests_one_pending_idx on public.event_change_requests(event_id) where status = 'pending';
create index messages_recipient_idx on public.messages(recipient_id, is_read, created_at desc);
create index signup_requests_status_idx on public.signup_requests(status, created_at desc);
create index signup_requests_approved_user_idx on public.signup_requests(approved_user_id);
create index signup_requests_login_id_hash_idx on public.signup_requests(requested_login_id_hash);
create unique index password_history_user_fingerprint_idx on public.password_history(user_id, password_fingerprint);
create index password_history_user_created_idx on public.password_history(user_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

create trigger events_set_updated_at before update on public.calendar_events
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (
    id, login_id, login_id_hash, display_name, department, role, account_status,
    must_change_password, birth_month_day, password_changed_at
  ) values (
    new.id,
    'pending:' || new.id::text,
    encode(digest(new.id::text, 'sha256'), 'hex'),
    'pending',
    '미지정',
    coalesce((new.raw_app_meta_data->>'role')::public.user_role, 'user'),
    'active',
    true,
    null,
    null
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
