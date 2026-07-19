-- 운영 적용 순서:
-- 1) npm run migrate-content-encryption
-- 2) 이 SQL 실행
-- 이후 service_role을 포함한 모든 DB 연결에서 평문 민감정보 삽입을 차단합니다.

do $$
begin
  if exists (
    select 1 from public.calendar_events
    where title not like 'enc:v1:%'
       or (description is not null and description not like 'enc:v1:%')
       or (public_note is not null and public_note not like 'enc:v1:%')
       or (admin_note is not null and admin_note not like 'enc:v1:%')
       or (rejection_reason is not null and rejection_reason not like 'enc:v1:%')
  ) then
    raise exception 'calendar_events에 평문 민감정보가 있습니다. npm run migrate-content-encryption을 먼저 실행하세요.';
  end if;

  if exists (
    select 1 from public.event_change_requests
    where reason not like 'enc:v1:%'
       or (proposed_title is not null and proposed_title not like 'enc:v1:%')
       or (proposed_description is not null and proposed_description not like 'enc:v1:%')
       or (proposed_public_note is not null and proposed_public_note not like 'enc:v1:%')
       or (proposed_admin_note is not null and proposed_admin_note not like 'enc:v1:%')
       or (rejection_reason is not null and rejection_reason not like 'enc:v1:%')
  ) then
    raise exception 'event_change_requests에 평문 민감정보가 있습니다. npm run migrate-content-encryption을 먼저 실행하세요.';
  end if;

  if exists (
    select 1 from public.messages
    where title not like 'enc:v1:%' or content not like 'enc:v1:%'
  ) then
    raise exception 'messages에 평문 민감정보가 있습니다. npm run migrate-content-encryption을 먼저 실행하세요.';
  end if;
end;
$$;

alter table public.calendar_events
  drop constraint if exists calendar_events_title_encrypted,
  drop constraint if exists calendar_events_description_encrypted,
  drop constraint if exists calendar_events_public_note_encrypted,
  drop constraint if exists calendar_events_admin_note_encrypted,
  drop constraint if exists calendar_events_rejection_reason_encrypted;

alter table public.calendar_events
  add constraint calendar_events_title_encrypted check (title like 'enc:v1:%'),
  add constraint calendar_events_description_encrypted check (description is null or description like 'enc:v1:%'),
  add constraint calendar_events_public_note_encrypted check (public_note is null or public_note like 'enc:v1:%'),
  add constraint calendar_events_admin_note_encrypted check (admin_note is null or admin_note like 'enc:v1:%'),
  add constraint calendar_events_rejection_reason_encrypted check (rejection_reason is null or rejection_reason like 'enc:v1:%');

alter table public.event_change_requests
  drop constraint if exists event_change_requests_reason_encrypted,
  drop constraint if exists event_change_requests_proposed_title_encrypted,
  drop constraint if exists event_change_requests_proposed_description_encrypted,
  drop constraint if exists event_change_requests_proposed_public_note_encrypted,
  drop constraint if exists event_change_requests_proposed_admin_note_encrypted,
  drop constraint if exists event_change_requests_rejection_reason_encrypted;

alter table public.event_change_requests
  add constraint event_change_requests_reason_encrypted check (reason like 'enc:v1:%'),
  add constraint event_change_requests_proposed_title_encrypted check (proposed_title is null or proposed_title like 'enc:v1:%'),
  add constraint event_change_requests_proposed_description_encrypted check (proposed_description is null or proposed_description like 'enc:v1:%'),
  add constraint event_change_requests_proposed_public_note_encrypted check (proposed_public_note is null or proposed_public_note like 'enc:v1:%'),
  add constraint event_change_requests_proposed_admin_note_encrypted check (proposed_admin_note is null or proposed_admin_note like 'enc:v1:%'),
  add constraint event_change_requests_rejection_reason_encrypted check (rejection_reason is null or rejection_reason like 'enc:v1:%');

alter table public.messages
  drop constraint if exists messages_title_encrypted,
  drop constraint if exists messages_content_encrypted;

alter table public.messages
  add constraint messages_title_encrypted check (title like 'enc:v1:%'),
  add constraint messages_content_encrypted check (content like 'enc:v1:%');
