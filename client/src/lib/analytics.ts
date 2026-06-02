/**
 * Utilidades para Google Analytics 4 y Google Ads Conversion Tracking
 */

// Declarar gtag como función global
declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

/**
 * Enviar evento a Google Analytics 4
 */
export function trackEvent(eventName: string, eventParams?: Record<string, any>) {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', eventName, eventParams);
    console.log('📊 GA4 Event:', eventName, eventParams);
  }
}

/**
 * Enviar conversión a Google Ads
 */
export function trackConversion(conversionLabel: string, value?: number) {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', 'conversion', {
      'send_to': `AW-17870821027/${conversionLabel}`,
      'value': value || 50,
      'currency': 'EUR'
    });
    console.log('🎯 Google Ads Conversion:', conversionLabel, value);
  }
}

/**
 * Eventos predefinidos para el sitio
 */
export const AnalyticsEvents = {
  // Evento: Usuario hace clic en "Solicita tu cita"
  clickCTA: () => {
    trackEvent('cta_click', {
      event_category: 'engagement',
      event_label: 'Solicita tu cita',
    });
  },

  // Evento: Usuario envía formulario de contacto
  submitContactForm: (formLocation: 'home' | 'ansiedad' | 'depresion' | 'header') => {
    trackEvent('form_submit', {
      event_category: 'conversion',
      event_label: `Formulario ${formLocation}`,
      form_location: formLocation,
    });
    
    // También enviar conversión a Google Ads
    trackConversion('Q4gFCNuW2eEBEKOtvMIC');
  },

  // Evento: Usuario visita landing page
  visitLandingPage: (page: 'ansiedad' | 'depresion') => {
    trackEvent('landing_page_view', {
      event_category: 'engagement',
      event_label: `Landing ${page}`,
      page_name: page,
    });
  },

  // Evento: Usuario abre el menú hamburguesa
  openMenu: () => {
    trackEvent('menu_open', {
      event_category: 'engagement',
      event_label: 'Menú hamburguesa',
    });
  },

  // Evento: Usuario navega a una sección
  navigateToSection: (sectionName: string) => {
    trackEvent('section_navigation', {
      event_category: 'engagement',
      event_label: sectionName,
      section: sectionName,
    });
  },

  // Evento: Usuario acepta cookies
  acceptCookies: () => {
    trackEvent('cookie_consent', {
      event_category: 'engagement',
      event_label: 'Cookies aceptadas',
    });
  },

  // Evento: Usuario hace clic en botón de reserva en tarifa
  clickPricingCTA: (sessionType: 'individual' | 'familiar') => {
    trackEvent('pricing_cta_click', {
      event_category: 'engagement',
      event_label: `Reservar ${sessionType}`,
      session_type: sessionType,
    });
  },
};
