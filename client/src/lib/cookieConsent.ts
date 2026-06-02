/**
 * Gestión de consentimiento de cookies y carga condicional de scripts
 */

const GOOGLE_ADS_ID = 'AW-17870821027';

/**
 * Cargar Google Ads solo si el usuario ha dado consentimiento
 */
export function loadGoogleAds() {
  // Verificar que no esté ya cargado
  if (window.gtag) {
    console.log('Google Ads ya está cargado');
    return;
  }

  // Crear script de gtag.js
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`;
  document.head.appendChild(script);

  // Inicializar dataLayer y gtag
  window.dataLayer = window.dataLayer || [];
  window.gtag = function() {
    window.dataLayer!.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', GOOGLE_ADS_ID);

  console.log('✅ Google Ads cargado con consentimiento');
}

/**
 * Obtener el estado actual del consentimiento
 */
export function getCookieConsent(): 'accepted' | 'rejected' | null {
  const consent = localStorage.getItem('cookie-consent');
  if (consent === 'accepted' || consent === 'rejected') {
    return consent;
  }
  return null;
}

/**
 * Guardar consentimiento y cargar scripts si es necesario
 */
export function saveCookieConsent(consent: 'accepted' | 'rejected') {
  localStorage.setItem('cookie-consent', consent);
  
  if (consent === 'accepted') {
    loadGoogleAds();
  }
}

/**
 * Inicializar scripts si ya hay consentimiento previo
 */
export function initializeWithConsent() {
  const consent = getCookieConsent();
  
  if (consent === 'accepted') {
    loadGoogleAds();
  }
}
