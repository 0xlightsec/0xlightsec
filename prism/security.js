'use strict';

/**
 * The main process's security decisions, kept free of Electron so they can be
 * unit-tested: which URLs are ours, which files may be served, which permissions
 * are granted.
 */

const path = require('node:path');

/**
 * Is this one of our own pages? Compares scheme and host directly: for a custom
 * scheme the URL standard defines .origin as the string "null", so comparing
 * origins would reject the app's own pages.
 */
function isAppUrl(target) {
  try {
    const u = new URL(target);
    return u.protocol === 'prism:' && u.host === 'app';
  } catch {
    return false;
  }
}

/** Resolve a prism:// request to a file inside `root`, or null if it would escape it. */
function resolveRequest(requestUrl, root) {
  let decoded;
  try {
    decoded = decodeURIComponent(new URL(requestUrl).pathname);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes('\0')) return null;
  const relative = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^\/+/, '');
  const target = path.normalize(path.join(root, relative));
  return target.startsWith(root + path.sep) ? target : null;
}

/**
 * Microphone (audio only, never camera) and MIDI, for our own pages only.
 * Electron reports a plain requestMIDIAccess() as 'midiSysex', so that name has
 * to be accepted for MIDI to work at all; the app itself never asks for sysex.
 */
function permitted(permission, origin, details = {}) {
  if (!isAppUrl(origin)) return false;
  if (permission === 'midi' || permission === 'midiSysex') return true;
  if (permission === 'media') {
    const types = details.mediaTypes ?? (details.mediaType ? [details.mediaType] : []);
    return types.length > 0 && types.every((t) => t === 'audio');
  }
  return false;
}

/** Only https links leave the app, and only to the system browser. */
function isExternalAllowed(target) {
  try {
    return new URL(target).protocol === 'https:';
  } catch {
    return false;
  }
}

module.exports = { isAppUrl, resolveRequest, permitted, isExternalAllowed };
