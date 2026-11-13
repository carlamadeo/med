export function isRecoverable(deletedAt: string, now = Date.now()): boolean {
  const age = now - Date.parse(deletedAt);
  return Number.isFinite(age) && age >= 0 && age < 30 * 86400000;
}
