import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim();
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: profiles } = await supabase.from('profiles').select('*').in('login_id', ['12345', '11111', '22222']);
const admin = profiles?.find((p) => p.login_id === '12345');
const user1 = profiles?.find((p) => p.login_id === '11111');
const user2 = profiles?.find((p) => p.login_id === '22222');
if (!admin || !user1 || !user2) throw new Error('먼저 npm run create-admin을 실행하세요.');

const today = new Date();
const iso = (date) => date.toISOString().slice(0, 10);
const plus = (days) => { const d = new Date(today); d.setDate(d.getDate() + days); return iso(d); };

const { data: events } = await supabase.from('calendar_events').insert([
  { user_id: user1.id, event_type: 'leave', title: '연차휴가', start_date: plus(3), end_date: plus(3), all_day: true, status: 'approved', approved_by: admin.id, approved_at: new Date().toISOString() },
  { user_id: user2.id, event_type: 'weekend_outing', title: '병원 외출', start_date: plus(5), end_date: plus(5), all_day: false, start_time: '14:00', end_time: '16:00', status: 'approved', approved_by: admin.id, approved_at: new Date().toISOString() },
  { user_id: user1.id, event_type: 'weekday_outing', title: '개인 일정', start_date: plus(7), end_date: plus(7), all_day: true, status: 'pending' },
  { user_id: user2.id, event_type: 'anniversary', title: '부서 창설기념일', start_date: plus(10), end_date: plus(10), all_day: true, status: 'approved', approved_by: admin.id, approved_at: new Date().toISOString() },
]).select();

await supabase.from('messages').insert({
  sender_id: admin.id,
  recipient_id: user1.id,
  related_event_id: events?.[0]?.id ?? null,
  title: '연차휴가 승인 안내',
  content: '등록한 연차휴가 일정이 승인되었습니다.',
  message_type: 'event_approved',
});

console.log('테스트 일정과 쪽지를 생성했습니다.');
