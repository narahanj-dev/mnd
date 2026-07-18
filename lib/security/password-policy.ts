export const PASSWORD_POLICY_TEXT =
  "비밀번호는 영문 대문자·영문 소문자·숫자·특수문자 중 3종류 이상을 포함해 9자 이상으로 입력하세요.";

const BLOCKED_WORDS = [
  "password", "passwd", "qwerty", "asdf", "zxcv", "admin", "administrator",
  "love", "happy", "welcome", "military", "army", "korea", "letmein",
];

function containsSequence(value: string) {
  const normalized = value.toLocaleLowerCase("en-US");
  const sequences = [
    "0123456789", "9876543210", "abcdefghijklmnopqrstuvwxyz", "zyxwvutsrqponmlkjihgfedcba",
    "qwertyuiop", "poiuytrewq", "asdfghjkl", "lkjhgfdsa", "zxcvbnm", "mnbvcxz",
  ];
  return sequences.some((sequence) => {
    for (let length = 4; length <= Math.min(8, normalized.length); length += 1) {
      for (let index = 0; index <= sequence.length - length; index += 1) {
        if (normalized.includes(sequence.slice(index, index + length))) return true;
      }
    }
    return false;
  });
}

export function validatePassword(password: string, context?: { loginId?: string; displayName?: string }) {
  if (password.length < 9) return "비밀번호는 최소 9자 이상이어야 합니다.";
  if (password.length > 100) return "비밀번호는 100자 이하로 입력하세요.";

  const categories = [/[A-Z]/.test(password), /[a-z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
  if (categories < 3) return PASSWORD_POLICY_TEXT;
  if (/\s/.test(password)) return "비밀번호에는 공백을 사용할 수 없습니다.";
  if (/(.)\1{3,}/.test(password)) return "같은 문자를 4번 이상 반복할 수 없습니다.";
  if (/\d{8,}/.test(password)) return "전화번호나 긴 일련번호처럼 추측하기 쉬운 숫자열은 사용할 수 없습니다.";
  if (containsSequence(password)) return "1234, qwerty, asdf처럼 연속된 문자열은 사용할 수 없습니다.";

  const lower = password.toLocaleLowerCase("en-US");
  if (BLOCKED_WORDS.some((word) => lower.includes(word))) {
    return "love, happy, password 등 잘 알려진 단어는 사용할 수 없습니다.";
  }
  const personalValues = [context?.loginId, context?.displayName]
    .filter((value): value is string => Boolean(value && value.trim().length >= 3))
    .map((value) => value.trim().toLocaleLowerCase("en-US"));
  if (personalValues.some((value) => lower.includes(value))) {
    return "아이디나 이름이 포함된 비밀번호는 사용할 수 없습니다.";
  }
  return null;
}

export function generateTemporaryPassword() {
  const cryptoObject = globalThis.crypto;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-+=";
  while (true) {
    const bytes = new Uint8Array(14);
    cryptoObject.getRandomValues(bytes);
    const password = Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
    if (!validatePassword(password)) return password;
  }
}
