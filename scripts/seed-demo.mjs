import { createClient } from '@supabase/supabase-js';
import {
  blindIndex,
  encryptValue,
  keyFromEnv,
  loadLocalEnv,
  requiredEnv,
} from './security-crypto.mjs';

loadLocalEnv();

if (process.env.NODE_ENV === 'production') {
  throw new Error('운영환경에서는 데모 데이터 생성을 실행할 수 없습니다.');
}
if (process.env.ALLOW_DEMO_SEED !== 'true') {
  throw new Error('데모 데이터 생성이 차단되어 있습니다. 로컬 테스트에서만 ALLOW_DEMO_SEED=true를 설정하세요.');
}

const supabaseUrl = requiredEnv('NEXT_PUBLIC_SUPABASE_URL');
const allowedProjectRef = requiredEnv('DEMO_SEED_ALLOWED_PROJECT_REF');
const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
if (projectRef !== allowedProjectRef) {
  throw new Error(`데모 데이터 허용 프로젝트가 아닙니다. 현재=${projectRef}, 허용=${allowedProjectRef}`);
}

const encryptionKey = keyFromEnv('PII_ENCRYPTION_KEY');
const hashKey = keyFromEnv('PII_HASH_KEY');
const supabase = createClient(
  supabaseUrl,
  requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const loginHash = (value) => blindIndex(value, 'login-id', hashKey);
const ids = [process.env.INITIAL_ADMIN_ID, process.env.TEST_USER_1_ID, process.env.TEST_USER_2_ID];
if (ids.some((value) => !value)) {
  throw new Error('INITIAL_ADMIN_ID, TEST_USER_1_ID, TEST_USER_2_ID가 필요합니다.');
}

const { data: profiles, error: profileError } = await supabase
  .from('profiles')
  .select('id,login_id_hash')
  .in('login_id_hash', ids.map(loginHash));
if (profileError) throw profileError;

const admin = profiles?.find((profile) => profile.login_id_hash === loginHash(ids[0]));
const user1 = profiles?.find((profile) => profile.login_id_hash === loginHash(ids[1]));
const user2 = profiles?.find((profile) => profile.login_id_hash === loginHash(ids[2]));
if (!admin || !user1 || !user2) throw new Error('먼저 npm run create-admin을 실행하세요.');

const today = new Date();
const iso = (date) => date.toISOString().slice(0, 10);
const plus = (days) => {
  const date = new Date(today);
  date.setDate(date.getDate() + days);
  return iso(date);
};
const encryptEvent = (row) => ({ ...row, title: encryptValue(row.title, encryptionKey) });

const { data: events, error: eventError } = await supabase.from('calendar_events').insert([
  encryptEvent({ user_id: user1.id, event_type: 'leave', title: '연가', start_date: plus(3), end_date: plus(3), all_day: true, status: 'approved', approved_by: admin.id, approved_at: new Date().toISOString() }),
  encryptEvent({ user_id: user2.id, event_type: 'weekend_outing', title: '병원 외출', start_date: plus(5), end_date: plus(5), all_day: false, start_time: '14:00', end_time: '16:00', status: 'approved', approved_by: admin.id, approved_at: new Date().toISOString() }),
  encryptEvent({ user_id: user1.id, event_type: 'weekday_outing', title: '개인 일정', start_date: plus(7), end_date: plus(7), all_day: true, status: 'pending' }),
  encryptEvent({ user_id: user2.id, event_type: 'anniversary', title: '부서 창설기념일', start_date: plus(10), end_date: plus(10), all_day: true, status: 'approved', approved_by: admin.id, approved_at: new Date().toISOString() }),
]).select('id');
if (eventError) throw eventError;

const { error: messageError } = await supabase.from('messages').insert({
  sender_id: admin.id,
  recipient_id: user1.id,
  related_event_id: events?.[0]?.id ?? null,
  title: encryptValue('연가 승인 안내', encryptionKey),
  content: encryptValue('등록한 연가 일정이 승인되었습니다.', encryptionKey),
  message_type: 'event_approved',
});
if (messageError) throw messageError;

console.log('암호화된 테스트 일정과 쪽지를 생성했습니다.');
