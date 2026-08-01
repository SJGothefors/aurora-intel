import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import sv from './locales/sv.json';
import en from './locales/en.json';

void i18n.use(initReactI18next).init({
  resources: { sv: { translation: sv }, en: { translation: en } },
  lng: 'sv',
  fallbackLng: 'sv',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
