// Speech synthesis voices a browser reports on each operating system.
//
// speechSynthesis.getVoices() lists the system's own voices followed by the voices
// Chrome adds itself, so the list gives the operating system away. These are the
// voices of default installations; a phone's are the ones a phone was read to report
// (tools/read-surface.mjs), whole and in its order.

import type { OsFamily, Voice } from './profile.ts';

const local = (name: string, lang: string, isDefault = false): Voice =>
  ({ name, lang, local: true, default: isDefault });
const remote = (name: string, lang: string): Voice => ({ name, lang, local: false, default: false });

// Network voices Chrome adds on every desktop system.
const GOOGLE: readonly Voice[] = [
  remote('Google Deutsch', 'de-DE'),
  remote('Google US English', 'en-US'),
  remote('Google UK English Female', 'en-GB'),
  remote('Google UK English Male', 'en-GB'),
  remote('Google español', 'es-ES'),
  remote('Google español de Estados Unidos', 'es-US'),
  remote('Google français', 'fr-FR'),
  remote('Google हिन्दी', 'hi-IN'),
  remote('Google Bahasa Indonesia', 'id-ID'),
  remote('Google italiano', 'it-IT'),
  remote('Google 日本語', 'ja-JP'),
  remote('Google 한국의', 'ko-KR'),
  remote('Google Nederlands', 'nl-NL'),
  remote('Google polski', 'pl-PL'),
  remote('Google português do Brasil', 'pt-BR'),
  remote('Google русский', 'ru-RU'),
  remote('Google 普通话（中国大陆）', 'zh-CN'),
  remote('Google 粤語（香港）', 'zh-HK'),
  remote('Google 國語（臺灣）', 'zh-TW'),
];

const SYSTEM: Record<OsFamily, readonly Voice[]> = {
  windows: [
    local('Microsoft David - English (United States)', 'en-US', true),
    local('Microsoft Mark - English (United States)', 'en-US'),
    local('Microsoft Zira - English (United States)', 'en-US'),
  ],
  macos: [
    local('Samantha', 'en-US', true), local('Alex', 'en-US'), local('Alice', 'it-IT'),
    local('Alva', 'sv-SE'), local('Amélie', 'fr-CA'), local('Anna', 'de-DE'),
    local('Carmit', 'he-IL'), local('Damayanti', 'id-ID'), local('Daniel', 'en-GB'),
    local('Diego', 'es-AR'), local('Ellen', 'nl-BE'), local('Fiona', 'en-GB'),
    local('Fred', 'en-US'), local('Ioana', 'ro-RO'), local('Joana', 'pt-PT'),
    local('Jorge', 'es-ES'), local('Juan', 'es-MX'), local('Kanya', 'th-TH'),
    local('Karen', 'en-AU'), local('Kyoko', 'ja-JP'), local('Laura', 'sk-SK'),
    local('Lekha', 'hi-IN'), local('Luca', 'it-IT'), local('Luciana', 'pt-BR'),
    local('Maged', 'ar-SA'), local('Mariska', 'hu-HU'), local('Mei-Jia', 'zh-TW'),
    local('Melina', 'el-GR'), local('Milena', 'ru-RU'), local('Moira', 'en-IE'),
    local('Monica', 'es-ES'), local('Nora', 'nb-NO'), local('Paulina', 'es-MX'),
    local('Rishi', 'en-IN'), local('Sara', 'da-DK'), local('Satu', 'fi-FI'),
    local('Sin-ji', 'zh-HK'), local('Tessa', 'en-ZA'), local('Thomas', 'fr-FR'),
    local('Ting-Ting', 'zh-CN'), local('Veena', 'en-IN'), local('Victoria', 'en-US'),
    local('Xander', 'nl-NL'), local('Yelda', 'tr-TR'), local('Yuna', 'ko-KR'),
    local('Yuri', 'ru-RU'), local('Zosia', 'pl-PL'), local('Zuzana', 'cs-CZ'),
  ],
  // Chrome on Linux has no system voices unless speech-dispatcher is set up.
  linux: [],
  // Read from Chrome 158 on a Galaxy (tools/read-surface.mjs): Android's text-to-speech
  // engine names its voices by language and region, gives scripts as "_#Latn", and marks
  // only the first as the default. They arrive some 12 ms after a page first asks.
  android: [
    local('Assamese India', 'as_IN', true), local('Bulgarian Bulgaria', 'bg_BG'),
    local('Bangla Bangladesh', 'bn_BD'), local('Bangla India', 'bn_IN'), local('Bodo India', 'brx_IN'),
    local('Bosnian Bosnia & Herzegovina', 'bs_BA_#Cyrl'),
    local('Bosnian Bosnia & Herzegovina', 'bs_BA_#Latn'), local('Catalan Spain', 'ca_ES'),
    local('Czech Czechia', 'cs_CZ'), local('Welsh United Kingdom', 'cy_GB'),
    local('Danish Denmark', 'da_DK'), local('German Germany', 'de_DE'), local('Dogri India', 'doi_IN'),
    local('Greek Greece', 'el_GR'), local('English Australia', 'en_AU'),
    local('English United Kingdom', 'en_GB'), local('English India', 'en_IN'),
    local('English Nigeria', 'en_NG'), local('English United States', 'en_US'),
    local('Spanish Spain', 'es_ES'), local('Spanish United States', 'es_US'),
    local('Estonian Estonia', 'et_EE'), local('Finnish Finland', 'fi_FI'),
    local('Filipino Philippines', 'fil_PH'), local('French Canada', 'fr_CA'),
    local('French France', 'fr_FR'), local('Gujarati India', 'gu_IN'), local('Hebrew Israel', 'he_IL'),
    local('Hindi India', 'hi_IN'), local('Hindi India', 'hi_IN_#Latn'), local('Croatian Croatia', 'hr_HR'),
    local('Hungarian Hungary', 'hu_HU'), local('Indonesian Indonesia', 'id_ID'),
    local('Icelandic Iceland', 'is_IS'), local('Italian Italy', 'it_IT'), local('Japanese Japan', 'ja_JP'),
    local('Javanese Indonesia', 'jv_ID'), local('Khmer Cambodia', 'km_KH'),
    local('Kannada India', 'kn_IN'), local('Korean South Korea', 'ko_KR'),
    local('Konkani India', 'kok_IN_#Deva'), local('Konkani India', 'kok_IN_#Latn'),
    local('Kashmiri India', 'ks_IN_#Arab'), local('Kashmiri India', 'ks_IN_#Deva'),
    local('Lithuanian Lithuania', 'lt_LT'), local('Latvian Latvia', 'lv_LV'),
    local('Maithili India', 'mai_IN'), local('Malayalam India', 'ml_IN'),
    local('Manipuri India', 'mni_IN_#Beng'), local('Marathi India', 'mr_IN'),
    local('Malay Malaysia', 'ms_MY'), local('Norwegian Bokmål Norway', 'nb_NO'),
    local('Nepali Nepal', 'ne_NP'), local('Dutch Belgium', 'nl_BE'), local('Dutch Netherlands', 'nl_NL'),
    local('Odia India', 'or_IN'), local('Punjabi India', 'pa_IN_#Guru'), local('Polish Poland', 'pl_PL'),
    local('Portuguese Brazil', 'pt_BR'), local('Portuguese Portugal', 'pt_PT'),
    local('Romanian Romania', 'ro_RO'), local('Russian Russia', 'ru_RU'), local('Sanskrit India', 'sa_IN'),
    local('Santali India', 'sat_IN_#Olck'), local('Sindhi India', 'sd_IN_#Deva'),
    local('Sinhala Sri Lanka', 'si_LK'), local('Slovak Slovakia', 'sk_SK'),
    local('Slovenian Slovenia', 'sl_SI'), local('Albanian Albania', 'sq_AL'),
    local('Serbian Serbia', 'sr_RS_#Cyrl'), local('Serbian Serbia', 'sr_RS_#Latn'),
    local('Sundanese Indonesia', 'su_ID_#Latn'), local('Swedish Sweden', 'sv_SE'),
    local('Swahili Kenya', 'sw_KE'), local('Tamil India', 'ta_IN'), local('Telugu India', 'te_IN'),
    local('Thai Thailand', 'th_TH'), local('Turkish Türkiye', 'tr_TR'),
    local('Ukrainian Ukraine', 'uk_UA'), local('Urdu India', 'ur_IN'), local('Urdu Pakistan', 'ur_PK'),
    local('Vietnamese Vietnam', 'vi_VN'), local('Cantonese Hong Kong', 'yue_HK_#Hant'),
    local('Chinese China', 'zh_CN_#Hans'), local('Chinese Hong Kong', 'zh_HK_#Hans'),
    local('Chinese Macao', 'zh_MO_#Hans'), local('Chinese Malaysia', 'zh_MY_#Hans'),
    local('Chinese Singapore', 'zh_SG_#Hans'), local('Chinese Hong Kong', 'zh_HK_#Hant'),
    local('Chinese Macao', 'zh_MO_#Hant'), local('Chinese Malaysia', 'zh_MY_#Hant'),
    local('Chinese Taiwan', 'zh_TW_#Hant'),
  ],
  // Read from Safari on an iPhone 17 Pro Max (iOS 18.7): the compact voice of each
  // language after the English ones, which include the novelty voices. Safari marks
  // every one of them as the default.
  ios: [
    local('Samantha', 'en-US', true), local('Albert', 'en-US', true), local('Bad News', 'en-US', true),
    local('Bahh', 'en-US', true), local('Bells', 'en-US', true), local('Boing', 'en-US', true),
    local('Bubbles', 'en-US', true), local('Cellos', 'en-US', true), local('Wobble', 'en-US', true),
    local('Fred', 'en-US', true), local('Good News', 'en-US', true), local('Jester', 'en-US', true),
    local('Junior', 'en-US', true), local('Kathy', 'en-US', true), local('Organ', 'en-US', true),
    local('Superstar', 'en-US', true), local('Ralph', 'en-US', true), local('Trinoids', 'en-US', true),
    local('Whisper', 'en-US', true), local('Zarvox', 'en-US', true), local('Daniel', 'en-GB', true),
    local('Karen', 'en-AU', true), local('Moira', 'en-IE', true), local('Rishi', 'en-IN', true),
    local('Tessa', 'en-ZA', true), local('Alice', 'it-IT', true), local('Alva', 'sv-SE', true),
    local('Amélie', 'fr-CA', true), local('Amira', 'ms-MY', true), local('Anna', 'de-DE', true),
    local('Carmit', 'he-IL', true), local('Damayanti', 'id-ID', true), local('Daria', 'bg-BG', true),
    local('Ellen', 'nl-BE', true), local('Ioana', 'ro-RO', true), local('Joana', 'pt-PT', true),
    local('Kanya', 'th-TH', true), local('Kyoko', 'ja-JP', true), local('Lana', 'hr-HR', true),
    local('Laura', 'sk-SK', true), local('Lekha', 'hi-IN', true), local('Lesya', 'uk-UA', true),
    local('Linh', 'vi-VN', true), local('Luciana', 'pt-BR', true), local('Majed', 'ar-001', true),
    local('Tünde', 'hu-HU', true), local('Meijia', 'zh-TW', true), local('Melina', 'el-GR', true),
    local('Milena', 'ru-RU', true), local('Mónica', 'es-ES', true), local('Montse', 'ca-ES', true),
    local('Nora', 'nb-NO', true), local('Paulina', 'es-MX', true), local('Sara', 'da-DK', true),
    local('Satu', 'fi-FI', true), local('Sinji', 'yue-HK', true), local('Thomas', 'fr-FR', true),
    local('Tina', 'sl-SI', true), local('Tingting', 'zh-CN', true), local('Xander', 'nl-NL', true),
    local('Yelda', 'tr-TR', true), local('Yuna', 'ko-KR', true), local('Zosia', 'pl-PL', true),
    local('Zuzana', 'cs-CZ', true), local('Vani', 'ta-IN', true), local('Soumya', 'kn-IN', true),
    local('Geeta', 'te-IN', true), local('Piya', 'bn-IN', true),
  ],
};

/** The voices a default installation of `os` reports, in the order its browser lists them. */
export function voicesFor(os: OsFamily): Voice[] {
  // The "Google" network voices belong to desktop Chrome only.
  const voices = os === 'android' || os === 'ios' ? SYSTEM[os] : [...SYSTEM[os], ...GOOGLE];
  return voices.map((voice) => ({ ...voice }));
}
