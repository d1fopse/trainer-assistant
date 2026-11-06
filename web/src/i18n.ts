import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import uk from './locales/uk.json';
import ru from './locales/ru.json';

// Українська — мова за замовчуванням. Англійську додамо пізніше: достатньо нового файлу в locales/.
void i18n.use(initReactI18next).init({
  resources: { uk: { translation: uk }, ru: { translation: ru } },
  lng: 'uk',
  fallbackLng: 'uk',
  interpolation: { escapeValue: false },
});

export default i18n;
