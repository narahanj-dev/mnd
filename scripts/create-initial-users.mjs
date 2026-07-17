import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 .env.local에 입력하세요.');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const domain = 'leave-calendar.local';
const users = [
  {
    loginId: process.env.INITIAL_ADMIN_ID || '12345',
    password: process.env.INITIAL_ADMIN_PASSWORD || '12345',
    displayName: '관리자',
    department: '관리부서',
    role: 'admin',
  },
  {
    loginId: process.env.TEST_USER_1_ID || '11111',
    password: process.env.TEST_USER_1_PASSWORD || '11111',
    displayName: '사용자1',
    department: '1부서',
    role: 'user',
  },
  {
    loginId: process.env.TEST_USER_2_ID || '22222',
    password: process.env.TEST_USER_2_PASSWORD || '22222',
    displayName: '사용자2',
    department: '2부서',
    role: 'user',
  },
];

const { data: existing } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });

for (const account of users) {
  const email = `${account.loginId}@${domain}`;
  let authUser = existing?.users.find((user) => user.email === email);

  if (!authUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: account.password,
      email_confirm: true,
      app_metadata: { role: account.role },
      user_metadata: {
        login_id: account.loginId,
        display_name: account.displayName,
        department: account.department,
        must_change_password: false,
      },
    });
    if (error) {
      console.error(`${account.loginId} 생성 실패:`, error.message);
      continue;
    }
    authUser = data.user;
    console.log(`${account.loginId} 계정을 생성했습니다.`);
  } else {
    await supabase.auth.admin.updateUserById(authUser.id, {
      password: account.password,
      app_metadata: { role: account.role },
      user_metadata: {
        login_id: account.loginId,
        display_name: account.displayName,
        department: account.department,
        must_change_password: false,
      },
    });
    console.log(`${account.loginId} 계정이 이미 있어 비밀번호와 정보를 갱신했습니다.`);
  }

  await supabase.from('profiles').upsert({
    id: authUser.id,
    login_id: account.loginId,
    display_name: account.displayName,
    department: account.department,
    role: account.role,
    account_status: 'active',
    must_change_password: false,
  });

  if (account.role === 'admin') {
    await supabase.from('admin_settings').upsert({
      admin_user_id: authUser.id,
      display_name: account.displayName,
    }, { onConflict: 'admin_user_id' });
  }
}

console.log('\n초기 계정 준비 완료');
console.log('관리자: 12345 / 12345');
console.log('사용자1: 11111 / 11111');
console.log('사용자2: 22222 / 22222');
console.log('실제 운영 전에는 반드시 비밀번호를 변경하세요.');
