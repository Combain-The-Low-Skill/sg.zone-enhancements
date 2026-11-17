'use strict';

const IMAGE_HOSTS = new Set(['images.sg.zone', 'i.ibb.co', 'i.imgur.com']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function allowedImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && IMAGE_HOSTS.has(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function fetchImage(candidates) {
  for (const value of candidates.slice(0, 3)) {
    const url = allowedImageUrl(value);
    if (!url) continue;
    try {
      const response = await fetch(url, {
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        referrerPolicy: 'no-referrer'
      });
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || '';
      if (!contentType.startsWith('image/')) continue;
      const announcedSize = Number(response.headers.get('content-length')) || 0;
      if (announcedSize > MAX_IMAGE_BYTES) continue;
      if (!response.body) continue;
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_IMAGE_BYTES) { await reader.cancel(); break; }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      if (!size || size > MAX_IMAGE_BYTES) continue;
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) continue;
      return {
        ok: true,
        dataUrl: `data:${contentType};base64,${bytesToBase64(bytes)}`
      };
    } catch {
      // Try the next verified representation of the same image.
    }
  }
  return { ok: false };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let senderUrl;
  try {
    senderUrl = new URL(sender.url || sender.tab?.url || '');
  } catch {
    return false;
  }
  if (senderUrl.origin !== 'https://sg.zone' ||
      message?.type !== 'sgx:load-mission-image' ||
      !Array.isArray(message.candidates)) {
    return false;
  }

  void fetchImage(message.candidates).then(sendResponse);
  return true;
});

