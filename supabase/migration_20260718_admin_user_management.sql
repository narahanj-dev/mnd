-- 관리자 사용자 관리 기능 보강
-- 1) 계정 삭제 시 해당 사용자의 일정, 쪽지, 변경 요청, 관리자 설정 등을 함께 삭제
-- 2) 다른 사용자가 처리한 기록은 삭제하지 않고 처리자/승인자만 NULL 처리
-- 3) 승인된 회원가입 신청과 실제 사용자 계정을 연결

alter table public.signup_requests
  add column if not exists approved_user_id uuid;

update public.signup_requests sr
set approved_user_id = p.id
from public.profiles p
where sr.approved_user_id is null
  and sr.status = 'approved'
  and sr.requested_login_id = p.login_id;

alter table public.signup_requests drop constraint if exists signup_requests_approved_user_id_fkey;
alter table public.signup_requests
  add constraint signup_requests_approved_user_id_fkey
  foreign key (approved_user_id) references public.profiles(id) on delete cascade;

alter table public.signup_requests drop constraint if exists signup_requests_processed_by_fkey;
alter table public.signup_requests
  add constraint signup_requests_processed_by_fkey
  foreign key (processed_by) references public.profiles(id) on delete set null;

alter table public.calendar_events drop constraint if exists calendar_events_user_id_fkey;
alter table public.calendar_events
  add constraint calendar_events_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.calendar_events drop constraint if exists calendar_events_approved_by_fkey;
alter table public.calendar_events
  add constraint calendar_events_approved_by_fkey
  foreign key (approved_by) references public.profiles(id) on delete set null;

alter table public.event_change_requests drop constraint if exists event_change_requests_requester_id_fkey;
alter table public.event_change_requests
  add constraint event_change_requests_requester_id_fkey
  foreign key (requester_id) references public.profiles(id) on delete cascade;

alter table public.event_change_requests drop constraint if exists event_change_requests_processed_by_fkey;
alter table public.event_change_requests
  add constraint event_change_requests_processed_by_fkey
  foreign key (processed_by) references public.profiles(id) on delete set null;

alter table public.messages drop constraint if exists messages_sender_id_fkey;
alter table public.messages
  add constraint messages_sender_id_fkey
  foreign key (sender_id) references public.profiles(id) on delete cascade;

alter table public.messages drop constraint if exists messages_recipient_id_fkey;
alter table public.messages
  add constraint messages_recipient_id_fkey
  foreign key (recipient_id) references public.profiles(id) on delete cascade;

alter table public.messages drop constraint if exists messages_related_event_id_fkey;
alter table public.messages
  add constraint messages_related_event_id_fkey
  foreign key (related_event_id) references public.calendar_events(id) on delete cascade;

create index if not exists signup_requests_approved_user_idx
  on public.signup_requests(approved_user_id);
