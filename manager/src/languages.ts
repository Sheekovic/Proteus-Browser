// The languages of a browser set up in a country: what a profile without a language
// list of its own reports when it is matched to where its proxy comes out.
//
// Chrome starts with a language list that belongs to the language of its interface,
// not to the country: the lists below are Chrome's own (IDS_ACCEPT_LANGUAGES in
// components/strings/components_locale_settings_<language>.xtb of its source), so a
// profile matched to Germany reports what a Chrome installed in German reports.
// Which interface language a country's browsers mostly have is the table after it.

import type { OsFamily } from './profile.ts';

/** Chrome's first language list for each language of its interface. */
const CHROME_LISTS: Record<string, string> = {
  'en-US': 'en-US,en', 'en-GB': 'en-GB,en-US,en',
  ar: 'ar,en-US,en', bg: 'bg-BG,bg', bn: 'bn-IN,bn,en-US,en', cs: 'cs-CZ,cs', da: 'da-DK,da,en-US,en',
  de: 'de-DE,de,en-US,en', el: 'el-GR,el', 'es-419': 'es-419,es', es: 'es-ES,es', et: 'et-EE,et,en-US,en',
  fa: 'fa,en-US,en', fi: 'fi-FI,fi,en-US,en', fr: 'fr-FR,fr,en-US,en', he: 'he-IL,he,en-US,en',
  hi: 'hi-IN,hi,en-US,en', hr: 'hr-HR,hr,en-US,en', hu: 'hu-HU,hu,en-US,en', id: 'id-ID,id,en-US,en',
  it: 'it-IT,it,en-US,en', ja: 'ja,en-US,en', ko: 'ko-KR,ko,en-US,en', lt: 'lt,en-US,en,ru,pl',
  lv: 'lv-LV,lv,en-US,en', nb: 'nb-NO,nb,no,nn,en-US,en', nl: 'nl-NL,nl,en-US,en', pl: 'pl-PL,pl,en-US,en',
  'pt-BR': 'pt-BR,pt,en-US,en', 'pt-PT': 'pt-PT,pt,en-US,en', ro: 'ro-RO,ro,en-US,en', ru: 'ru-RU,ru,en-US,en',
  sk: 'sk-SK,sk,cs,en-US,en', sl: 'sl-SI,sl,en-GB,en', sr: 'sr-RS,sr,en-US,en', sv: 'sv-SE,sv,en-US,en',
  th: 'th-TH,th', tr: 'tr-TR,tr,en-US,en', uk: 'uk-UA,uk,en-US,en', vi: 'vi-VN,vi,fr-FR,fr,en-US,en',
  'zh-CN': 'zh-CN,zh', 'zh-TW': 'zh-TW,zh,en-US,en',
};

/** The interface language most browsers of a country have. A country not here: en-US. */
const COUNTRY_LANGUAGE: Record<string, string> = {};
for (const [language, countries] of Object.entries({
  'en-GB': 'GB IE AU NZ ZA',
  ar: 'EG SA AE MA DZ TN IQ JO KW QA BH OM LB LY SY YE SD PS',
  bg: 'BG', bn: 'BD', cs: 'CZ', da: 'DK', de: 'DE AT CH LI', el: 'GR CY', es: 'ES',
  'es-419': 'MX AR CO CL PE VE EC GT CU BO DO HN PY SV NI CR PA UY PR',
  et: 'EE', fa: 'IR', fi: 'FI', fr: 'FR LU MC', he: 'IL', hr: 'HR', hu: 'HU', id: 'ID', it: 'IT SM',
  ja: 'JP', ko: 'KR', lt: 'LT', lv: 'LV', nb: 'NO', nl: 'NL BE', pl: 'PL', 'pt-BR': 'BR', 'pt-PT': 'PT AO MZ',
  ro: 'RO MD', ru: 'RU BY KZ', sk: 'SK', sl: 'SI', sr: 'RS', sv: 'SE', th: 'TH', tr: 'TR', uk: 'UA', vi: 'VN',
  'zh-CN': 'CN', 'zh-TW': 'TW HK',
})) {
  for (const country of countries.split(' ')) COUNTRY_LANGUAGE[country] = language;
}

/**
 * The language list of a browser in `country` (two capital letters), most preferred
 * first. Chrome's list on a computer or an Android phone; Safari on an iPhone reports
 * one language, with the phone's region.
 */
export function languagesOf(country: string, os: OsFamily): string[] {
  const language = COUNTRY_LANGUAGE[country] ?? 'en-US';
  const list = CHROME_LISTS[language]!.split(',');
  if (os !== 'ios') return list;
  if (COUNTRY_LANGUAGE[country] === undefined || language.startsWith('zh')) return [list[0]!];
  return [`${language.split('-')[0]}-${country}`];
}
