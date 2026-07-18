-- 기존 설치 환경에 생년월일 및 일정 수정/삭제 승인 기능을 추가하는 마이그레이션입니다.
alter table public.profiles add column if not exists birth_date date;
alter table public.signup_requests add column if not exists birth_date date;

-- 기존 신청 데이터가 있을 수 있으므로 먼저 nullable로 추가합니다.
-- 운영 중인 기존 신청을 정리한 뒤 필요하면 별도로 NOT NULL 제약을 적용하세요.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'event_change_type') then
    create type public.event_change_type as enum ('update', 'delete');
  end if;
end $$;

create table if not exists public.event_change_requests (
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
  processed_by uuid references public.profiles(id),
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

create index if not exists event_change_requests_event_idx on public.event_change_requests(event_id, status);
create index if not exists event_change_requests_requester_idx on public.event_change_requests(requester_id, created_at desc);
create unique index if not exists event_change_requests_one_pending_idx on public.event_change_requests(event_id) where status = 'pending';

alter table public.event_change_requests enable row level security;

drop policy if exists "Users update own pending events" on public.calendar_events;
drop policy if exists "Users request cancellation" on public.calendar_events;
drop policy if exists "Users view own change requests" on public.event_change_requests;
drop policy if exists "Users create own change requests" on public.event_change_requests;
drop policy if exists "Admins manage change requests" on public.event_change_requests;

create policy "Users view own change requests"
on public.event_change_requests for select to authenticated
using (requester_id = (select auth.uid()) or public.is_admin());

create policy "Users create own change requests"
on public.event_change_requests for insert to authenticated
with check (
  requester_id = (select auth.uid())
  and exists (
    select 1 from public.calendar_events
    where id = event_id and user_id = (select auth.uid())
  )
);

create policy "Admins manage change requests"
on public.event_change_requests for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (
    id, login_id, display_name, department, role, account_status, must_change_password, birth_date
  ) values (
    new.id,
    coalesce(new.raw_user_meta_data->>'login_id', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'display_name', '사용자'),
    coalesce(new.raw_user_meta_data->>'department', '미지정'),
    coalesce((new.raw_app_meta_data->>'role')::public.user_role, 'user'),
    'active',
    coalesce((new.raw_user_meta_data->>'must_change_password')::boolean, false),
    nullif(new.raw_user_meta_data->>'birth_date', '')::date
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
