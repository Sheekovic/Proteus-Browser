// What a caller of the API or of an MCP tool may set on a profile.

import { type ProfileInput, ValidationError } from './profile.ts';

export const PROFILE_INPUT_KEYS = [
  'name', 'notes', 'tags', 'seed', 'os', 'userAgent', 'platform', 'uaData', 'hardwareConcurrency',
  'deviceMemory', 'screen', 'mobile', 'languages', 'timezone', 'webgl', 'webglCaps', 'webgpu', 'noise', 'voices', 'mediaDevices',
  'fonts', 'webrtc', 'webrtcPublicIp', 'geolocation', 'proxy', 'matchProxy', 'startUrl', 'cameraFile',
] as const;

/** Keeps only the fields a client may set, so unknown keys never reach a stored profile. */
export function toProfileInput(body: unknown): ProfileInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('the request body must be a JSON object');
  }
  const input: Record<string, unknown> = {};
  for (const key of PROFILE_INPUT_KEYS) {
    if (key in body) input[key] = (body as Record<string, unknown>)[key];
  }
  return input as ProfileInput;
}
