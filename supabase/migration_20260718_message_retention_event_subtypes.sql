-- 쪽지 15일 보관 및 휴가/외박 세부종류 전환

-- 기존 휴가와 외박 일정은 요청한 기본 세부종류로 일괄 변경합니다.
update public.calendar_events
set title = '연가'
where event_type = 'leave';

update public.calendar_events
set title = '정기외박'
where event_type = 'overnight';

-- 아직 처리되지 않은 일정 수정 요청의 제안값도 같은 기준으로 맞춥니다.
update public.event_change_requests
set proposed_title = '연가'
where proposed_event_type = 'leave';

update public.event_change_requests
set proposed_title = '정기외박'
where proposed_event_type = 'overnight';

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

-- Supabase의 pg_cron으로 매일 03:17(UTC, 한국시간 12:17)에 정리합니다.
-- pg_cron 활성화가 불가능한 환경이어도 나머지 SQL은 정상 적용됩니다.
do $cron_setup$
declare
  existing_job_id bigint;
begin
  begin
    execute 'create extension if not exists pg_cron';
  exception when others then
    raise notice 'pg_cron 확장을 자동 활성화하지 못했습니다: %', sqlerrm;
  end;

  if to_regclass('cron.job') is not null then
    for existing_job_id in execute
      'select jobid from cron.job where jobname = ''delete-expired-unarchived-messages'''
    loop
      execute format('select cron.unschedule(%s)', existing_job_id);
    end loop;

    execute $schedule$
      select cron.schedule(
        'delete-expired-unarchived-messages',
        '17 3 * * *',
        'select public.delete_expired_unarchived_messages();'
      )
    $schedule$;
  else
    raise notice 'pg_cron이 비활성화되어 예약 작업은 생략했습니다. 쪽지함 접속 시 앱에서 만료 쪽지를 정리합니다.';
  end if;
end;
$cron_setup$;

-- SQL 실행 즉시 이미 15일이 지난 미보관 쪽지도 한 번 정리합니다.
select public.delete_expired_unarchived_messages();
