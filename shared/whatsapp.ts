// Enlaces de WhatsApp a partir de un teléfono como «+34 620 450 696».
// Sin prefijo de país se entiende España (+34).
export function whatsappNumber(phone: string): string | null {
  let digits = phone.replace(/\D/g, "");
  if (phone.trim().startsWith("00")) digits = digits.slice(2);
  if (digits.length === 9) digits = `34${digits}`;
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

export function whatsappLinks(phone: string): { app: string; web: string } | null {
  const n = whatsappNumber(phone);
  return n ? { app: `whatsapp://send?phone=${n}`, web: `https://wa.me/${n}` } : null;
}

// ¿Móvil o tableta? (ahí se abre la app directamente)
export function isMobileDevice(userAgent: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}
