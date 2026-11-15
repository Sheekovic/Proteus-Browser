// Speech synthesis voices a browser reports on each operating system.
//
// speechSynthesis.getVoices() lists the system's own voices followed by the voices
// Chrome adds itself, so the list gives the operating system away. These are the
// voices of default installations.

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
};

/** The voices a default installation of `os` reports, in the order Chrome lists them. */
export function voicesFor(os: OsFamily): Voice[] {
  return [...SYSTEM[os], ...GOOGLE].map((voice) => ({ ...voice }));
}
