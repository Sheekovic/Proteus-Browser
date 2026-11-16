// Reading proxies the way providers hand them out: one per line, in whichever of
// the usual spellings.
//
//   host:port                      host:port:user:password        host;port;user;password
//   user:password@host:port        http://user:password@host:port socks5://host:port
//
// A line without a scheme takes `defaultType`.

import { type ProxySettings, validateProxy, ValidationError } from './profile.ts';

const SCHEMES: Record<string, ProxySettings['type']> = { http: 'http', https: 'http', socks5: 'socks5', socks5h: 'socks5', socks: 'socks5' };

/** One line of a proxy list. Throws ValidationError naming what is wrong with it. */
export function parseProxyLine(line: string, defaultType: ProxySettings['type'] = 'http'): ProxySettings {
  let rest = line.trim();
  let type = defaultType;
  const scheme = /^([a-z0-9]+):\/\//i.exec(rest);
  if (scheme) {
    const known = SCHEMES[scheme[1].toLowerCase()];
    if (!known) throw new ValidationError(`"${scheme[1]}" is not a kind of proxy Proteus can use (http or socks5)`);
    type = known;
    rest = rest.slice(scheme[0].length).replace(/\/+$/, '');
  }
  let host: string, port: string, username: string | undefined, password: string | undefined;
  const at = rest.lastIndexOf('@');
  if (at >= 0) {
    // user:password@host:port — the password may itself hold ":" or "@".
    const login = rest.slice(0, at), colon = login.indexOf(':');
    username = colon >= 0 ? login.slice(0, colon) : login;
    password = colon >= 0 ? login.slice(colon + 1) : '';
    [host, port] = splitHostPort(rest.slice(at + 1));
  } else {
    const parts = rest.split(rest.includes(';') ? ';' : ':');
    if (parts.length < 2) throw new ValidationError(`"${shorten(line)}" is not host:port`);
    [host, port] = [parts[0], parts[1]];
    if (parts.length > 2) {
      username = parts[2];
      // Whatever follows the user name is the password, separators included.
      password = parts.slice(3).join(rest.includes(';') ? ';' : ':');
    }
  }
  const proxy: ProxySettings = { type, host: host.trim(), port: Number(port) };
  if (username !== undefined && username !== '') {
    proxy.username = username;
    proxy.password = password ?? '';
  }
  try {
    validateProxy(proxy);
  } catch (error) {
    throw new ValidationError(`"${shorten(line)}": ${(error as Error).message}`);
  }
  return proxy;
}

function splitHostPort(text: string): [string, string] {
  const colon = text.lastIndexOf(':');
  if (colon < 0) throw new ValidationError(`"${shorten(text)}" has no port`);
  return [text.slice(0, colon), text.slice(colon + 1)];
}

/** The start of a line, for an error message: enough to find it, without its password. */
function shorten(line: string): string {
  const text = line.trim();
  return text.length > 24 ? text.slice(0, 24) + '…' : text;
}

/** Every proxy of a pasted list: blank lines and lines starting with # are skipped. */
export function parseProxyList(text: string, defaultType: ProxySettings['type'] = 'http'): ProxySettings[] {
  return text.split(/\r?\n/).map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((line) => parseProxyLine(line, defaultType));
}
