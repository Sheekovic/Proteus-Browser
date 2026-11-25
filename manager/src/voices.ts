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
// Safari marks every voice as the default and gives each an address that is not its name.
const apple = (name: string, lang: string, uri: string): Voice => ({ name, lang, local: true, default: true, uri });

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
  // Read from Safari on an iPhone (iOS 18.7): the compact voice of each language after
  // the English ones, which include the novelty voices. Safari marks every one of
  // them as the default, and each has an address (voiceURI) that is not its name.
  ios: [
    apple('Samantha', 'en-US', 'com.apple.voice.super-compact.en-US.Samantha'),
    apple('Albert', 'en-US', 'com.apple.speech.synthesis.voice.Albert'),
    apple('Bad News', 'en-US', 'com.apple.speech.synthesis.voice.BadNews'),
    apple('Bahh', 'en-US', 'com.apple.speech.synthesis.voice.Bahh'),
    apple('Bells', 'en-US', 'com.apple.speech.synthesis.voice.Bells'),
    apple('Boing', 'en-US', 'com.apple.speech.synthesis.voice.Boing'),
    apple('Bubbles', 'en-US', 'com.apple.speech.synthesis.voice.Bubbles'),
    apple('Cellos', 'en-US', 'com.apple.speech.synthesis.voice.Cellos'),
    apple('Wobble', 'en-US', 'com.apple.speech.synthesis.voice.Deranged'),
    apple('Fred', 'en-US', 'com.apple.speech.synthesis.voice.Fred'),
    apple('Good News', 'en-US', 'com.apple.speech.synthesis.voice.GoodNews'),
    apple('Jester', 'en-US', 'com.apple.speech.synthesis.voice.Hysterical'),
    apple('Junior', 'en-US', 'com.apple.speech.synthesis.voice.Junior'),
    apple('Kathy', 'en-US', 'com.apple.speech.synthesis.voice.Kathy'),
    apple('Organ', 'en-US', 'com.apple.speech.synthesis.voice.Organ'),
    apple('Superstar', 'en-US', 'com.apple.speech.synthesis.voice.Princess'),
    apple('Ralph', 'en-US', 'com.apple.speech.synthesis.voice.Ralph'),
    apple('Trinoids', 'en-US', 'com.apple.speech.synthesis.voice.Trinoids'),
    apple('Whisper', 'en-US', 'com.apple.speech.synthesis.voice.Whisper'),
    apple('Zarvox', 'en-US', 'com.apple.speech.synthesis.voice.Zarvox'),
    apple('Daniel', 'en-GB', 'com.apple.voice.super-compact.en-GB.Daniel'),
    apple('Karen', 'en-AU', 'com.apple.voice.super-compact.en-AU.Karen'),
    apple('Moira', 'en-IE', 'com.apple.voice.super-compact.en-IE.Moira'),
    apple('Rishi', 'en-IN', 'com.apple.voice.super-compact.en-IN.Rishi'),
    apple('Tessa', 'en-ZA', 'com.apple.voice.super-compact.en-ZA.Tessa'),
    apple('Alice', 'it-IT', 'com.apple.voice.super-compact.it-IT.Alice'),
    apple('Alva', 'sv-SE', 'com.apple.voice.super-compact.sv-SE.Alva'),
    apple('Amélie', 'fr-CA', 'com.apple.voice.super-compact.fr-CA.Amelie'),
    apple('Amira', 'ms-MY', 'com.apple.voice.super-compact.ms-MY.Amira'),
    apple('Anna', 'de-DE', 'com.apple.voice.super-compact.de-DE.Anna'),
    apple('Carmit', 'he-IL', 'com.apple.voice.super-compact.he-IL.Carmit'),
    apple('Damayanti', 'id-ID', 'com.apple.voice.super-compact.id-ID.Damayanti'),
    apple('Daria', 'bg-BG', 'com.apple.voice.super-compact.bg-BG.Daria'),
    apple('Ellen', 'nl-BE', 'com.apple.voice.super-compact.nl-BE.Ellen'),
    apple('Ioana', 'ro-RO', 'com.apple.voice.super-compact.ro-RO.Ioana'),
    apple('Joana', 'pt-PT', 'com.apple.voice.super-compact.pt-PT.Joana'),
    apple('Kanya', 'th-TH', 'com.apple.voice.super-compact.th-TH.Kanya'),
    apple('Kyoko', 'ja-JP', 'com.apple.voice.super-compact.ja-JP.Kyoko'),
    apple('Lana', 'hr-HR', 'com.apple.voice.super-compact.hr-HR.Lana'),
    apple('Laura', 'sk-SK', 'com.apple.voice.super-compact.sk-SK.Laura'),
    apple('Lekha', 'hi-IN', 'com.apple.voice.super-compact.hi-IN.Lekha'),
    apple('Lesya', 'uk-UA', 'com.apple.voice.super-compact.uk-UA.Lesya'),
    apple('Linh', 'vi-VN', 'com.apple.voice.super-compact.vi-VN.Linh'),
    apple('Luciana', 'pt-BR', 'com.apple.voice.super-compact.pt-BR.Luciana'),
    apple('Majed', 'ar-001', 'com.apple.voice.super-compact.ar-001.Maged'),
    apple('Tünde', 'hu-HU', 'com.apple.voice.super-compact.hu-HU.Mariska'),
    apple('Meijia', 'zh-TW', 'com.apple.voice.super-compact.zh-TW.Meijia'),
    apple('Melina', 'el-GR', 'com.apple.voice.super-compact.el-GR.Melina'),
    apple('Milena', 'ru-RU', 'com.apple.voice.super-compact.ru-RU.Milena'),
    apple('Mónica', 'es-ES', 'com.apple.voice.super-compact.es-ES.Monica'),
    apple('Montse', 'ca-ES', 'com.apple.voice.super-compact.ca-ES.Montserrat'),
    apple('Nora', 'nb-NO', 'com.apple.voice.super-compact.nb-NO.Nora'),
    apple('Paulina', 'es-MX', 'com.apple.voice.super-compact.es-MX.Paulina'),
    apple('Sara', 'da-DK', 'com.apple.voice.super-compact.da-DK.Sara'),
    apple('Satu', 'fi-FI', 'com.apple.voice.super-compact.fi-FI.Satu'),
    apple('Sinji', 'yue-HK', 'com.apple.voice.super-compact.zh-HK.Sinji'),
    apple('Thomas', 'fr-FR', 'com.apple.voice.super-compact.fr-FR.Thomas'),
    apple('Tina', 'sl-SI', 'com.apple.voice.super-compact.sl-SI.Tina'),
    apple('Tingting', 'zh-CN', 'com.apple.voice.super-compact.zh-CN.Tingting'),
    apple('Xander', 'nl-NL', 'com.apple.voice.super-compact.nl-NL.Xander'),
    apple('Yelda', 'tr-TR', 'com.apple.voice.super-compact.tr-TR.Yelda'),
    apple('Yuna', 'ko-KR', 'com.apple.voice.super-compact.ko-KR.Yuna'),
    apple('Zosia', 'pl-PL', 'com.apple.voice.super-compact.pl-PL.Zosia'),
    apple('Zuzana', 'cs-CZ', 'com.apple.voice.super-compact.cs-CZ.Zuzana'),
    apple('Vani', 'ta-IN', 'com.apple.voice.super-compact.ta-IN.Vani'),
    apple('Soumya', 'kn-IN', 'com.apple.voice.compact.kn-IN.Alpana'),
    apple('Geeta', 'te-IN', 'com.apple.voice.compact.te-IN.Geeta'),
    apple('Piya', 'bn-IN', 'com.apple.voice.compact.bn-IN.Paya'),
  ],
};

/** The voices a default installation of `os` reports, in the order its browser lists them. */
export function voicesFor(os: OsFamily): Voice[] {
  // The "Google" network voices belong to desktop Chrome only.
  const voices = os === 'android' || os === 'ios' ? SYSTEM[os] : [...SYSTEM[os], ...GOOGLE];
  return voices.map((voice) => ({ ...voice }));
}
