export function normalizeUsername(input: string): string {
  const username = input.trim().toLowerCase()
  if (!/^[a-z0-9_]{3,32}$/.test(username))
    throw new Error('아이디는 영문·숫자·밑줄 3~32자로 입력하세요.')
  return username
}
