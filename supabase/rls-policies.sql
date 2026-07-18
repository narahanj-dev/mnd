-- schema.sql 실행 후 이 파일을 실행하세요.
create or replace function public.is_admin(check_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = check_user and role = 'admin' and account_status = 'active'
  );
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.signup_requests enable row level security;
alter table public.calendar_events enable row level security;
alter table public.event_change_requests enable row level security;
alter table public.messages enable row level security;
alter table public.admin_settings enable row level security;
alter table public.password_history enable row level security;

create policy "Authenticated users can view active profiles"
on public.profiles for select to authenticated
using (account_status = 'active' or id = (select auth.uid()) or public.is_admin());

create policy "Anyone can submit signup request"
on public.signup_requests for insert to anon, authenticated
with check (status = 'pending');

create policy "Admins manage signup requests"
on public.signup_requests for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Users view approved events or own events"
on public.calendar_events for select to authenticated
using (status = 'approved' or user_id = (select auth.uid()) or public.is_admin());

create policy "Users create own pending events"
on public.calendar_events for insert to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'pending'
);

create policy "Admins update events"
on public.calendar_events for update to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admins delete events"
on public.calendar_events for delete to authenticated
using (public.is_admin());

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

create policy "Recipients view own messages"
on public.messages for select to authenticated
using (recipient_id = (select auth.uid()) or public.is_admin());

create policy "Recipients update own messages"
on public.messages for update to authenticated
using (recipient_id = (select auth.uid()))
with check (recipient_id = (select auth.uid()));

create policy "Admins send messages"
on public.messages for insert to authenticated
with check (public.is_admin());

create policy "Admins view settings"
on public.admin_settings for select to authenticated
using (public.is_admin());

create policy "Admins manage settings"
on public.admin_settings for all to authenticated
using (public.is_admin())
with check (public.is_admin());

-- 민감한 테이블은 필요한 열만 일반 사용자에게 수정 권한을 부여한다.
revoke update on public.profiles from authenticated;
revoke all on public.password_history from anon, authenticated;
revoke update on public.messages from authenticated;
grant update (is_read, is_archived, read_at) on public.messages to authenticated;
