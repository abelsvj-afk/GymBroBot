import { fixEmojis as _fixEmojisInternal } from './emoji_map.js';

// We'll include a small local emoji map as a fallback if emoji_map isn't present
const defaultMap = {
  '≡ƒÆ¬': '💪', '≡ƒöÑ': '🔥', 'Γ¥î': '❌', 'Γ£à': '✅', '≡ƒÅå': '🏆', '≡ƒôê': '📈', '≡ƒÄ»': '✨', '≡ƒÆ»': '💯'
};

export function fixEmojis(text) {
  if (!text || typeof text !== 'string') return text;
  // try delegated map first
  try {
    return _fixEmojisInternal(text);
  } catch (e) {
    // fallback simple replacer
    let out = text;
    for (const k of Object.keys(defaultMap)) out = out.split(k).join(defaultMap[k]);
    out = out.replace(/[\uFFFD\u0000-\u001F]/g, '');
    return out;
  }
}

const recentChannelSends = {}; // channelId -> { text, ts }

export async function sendNormalized(channel, contentOrOptions) {
  try {
    let content = typeof contentOrOptions === 'string' ? contentOrOptions : (contentOrOptions.content || '');
    content = fixEmojis(content);

    // avoid sending the exact same content to the same channel within 2 minutes
    const last = recentChannelSends[channel.id];
    const now = Date.now();
    if (last && last.text === content && now - last.ts < 2 * 60 * 1000) {
      return null; // skip duplicate
    }
    recentChannelSends[channel.id] = { text: content, ts: now };

    if (typeof contentOrOptions === 'string') return await channel.send(content);
    if (contentOrOptions.embeds) {
      contentOrOptions.embeds.forEach(e => {
        if (e.title) e.title = fixEmojis(e.title);
        if (e.description) e.description = fixEmojis(e.description);
        if (e.footer && e.footer.text) e.footer.text = fixEmojis(e.footer.text);
      });
    }
    return await channel.send(contentOrOptions);
  } catch (e) {
    console.error('sendNormalized error (utils):', e);
    try { return await channel.send(typeof contentOrOptions === 'string' ? contentOrOptions : contentOrOptions.content || ''); } catch (e2) { return null; }
  }
}
