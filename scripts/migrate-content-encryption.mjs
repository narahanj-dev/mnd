import { createClient } from '@supabase/supabase-js';
import { encryptValue, keyFromEnv, loadLocalEnv, requiredEnv } from './security-crypto.mjs';

loadLocalEnv();

const key = keyFromEnv('PII_ENCRYPTION_KEY');
const admin = createClient(
  requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
  requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const PAGE_SIZE = 500;
const targets = [
  ['calendar_events', ['title', 'description', 'public_note', 'admin_note', 'rejection_reason']],
  ['event_change_requests', ['reason', 'proposed_title', 'proposed_description', 'proposed_public_note', 'proposed_admin_note', 'rejection_reason']],
  ['messages', ['title', 'content']],
];

for (const [table, fields] of targets) {
  let offset = 0;
  let scanned = 0;
  let updated = 0;

  while (true) {
    const { data: rows, error } = await admin
      .from(table)
      .select(`id,${fields.join(',')}`)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const update = {};
      for (const field of fields) {
        if (typeof row[field] === 'string' && !row[field].startsWith('enc:v1:')) {
          update[field] = encryptValue(row[field], key);
        }
      }

      if (Object.keys(update).length > 0) {
        const { error: updateError } = await admin.from(table).update(update).eq('id', row.id);
        if (updateError) throw updateError;
        updated += 1;
      }
    }

    scanned += rows.length;
    console.log(`${table}: ${scanned}건 확인, ${updated}건 암호화`);

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  console.log(`${table} 민감내용 암호화 완료 (전체 ${scanned}건, 변경 ${updated}건)`);
}

console.log('일정 제목·메모, 요청 사유, 쪽지 내용 암호화가 완료되었습니다.');
