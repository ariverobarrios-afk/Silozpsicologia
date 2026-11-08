// Reglas de la reserva de citas que el navegador usa para avisar antes de
// llamar al servidor. La que manda es la base de datos (supabase/schema.sql).

// ¿Se puede cancelar todavía desde la app? (más de cancelLimitHours antes)
export function canCancelOnline(startsAt: string, cancelLimitHours: number, now = Date.now()): boolean {
  return new Date(startsAt).getTime() - now > cancelLimitHours * 3_600_000;
}
