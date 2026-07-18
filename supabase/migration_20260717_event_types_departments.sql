-- 기존 설치 환경의 일정 종류를 다음 순서로 변경합니다.
-- 연가 / 외박 / 주말외출 / 평일외출 / 기념일
-- 기존 outing 데이터는 주말외출로, schedule 데이터는 평일외출로 변환됩니다.

do $$
declare
  current_labels text[];
begin
  select array_agg(e.enumlabel order by e.enumsortorder)
    into current_labels
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typname = 'event_type';

  if current_labels = array['leave', 'overnight', 'weekend_outing', 'weekday_outing', 'anniversary']::text[] then
    raise notice 'event_type은 이미 최신 상태입니다.';
    return;
  end if;

  if current_labels <> array['leave', 'outing', 'schedule', 'anniversary']::text[] then
    raise exception '예상하지 못한 event_type 구성입니다: %', current_labels;
  end if;

  execute 'alter type public.event_type rename to event_type_legacy_20260717';
  execute 'create type public.event_type as enum (''leave'', ''overnight'', ''weekend_outing'', ''weekday_outing'', ''anniversary'')';

  execute $sql$
    alter table public.calendar_events
    alter column event_type type public.event_type
    using (
      case event_type::text
        when 'leave' then 'leave'
        when 'outing' then 'weekend_outing'
        when 'schedule' then 'weekday_outing'
        when 'anniversary' then 'anniversary'
      end
    )::public.event_type
  $sql$;

  if to_regclass('public.event_change_requests') is not null then
    execute $sql$
      alter table public.event_change_requests
      alter column proposed_event_type type public.event_type
      using (
        case proposed_event_type::text
          when 'leave' then 'leave'
          when 'outing' then 'weekend_outing'
          when 'schedule' then 'weekday_outing'
          when 'anniversary' then 'anniversary'
          else null
        end
      )::public.event_type
    $sql$;
  end if;

  execute 'drop type public.event_type_legacy_20260717';
end $$;
