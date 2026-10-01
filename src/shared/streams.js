// Liste des streams : extraction depuis la page OnHockey.tv, détection de la langue,
// classement (français d'abord) et choix du stream de secours.

export function fold(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const LANG_PATTERNS = {
  fr: [
    /\b(fr|fra|french|francais|quebec|qc)\b/,
    /\brds\s?\d?\b/,
    /\btvas?\b/,
    /tva\s*sports/,
    /(^|[\/_-])(fr|quebec|qc|france)\.(png|gif|svg|jpe?g|webp)/,
    /flag[-_]?(fr|qc)\b/,
  ],
  en: [
    /\b(en|eng|english)\b/,
    /\b(tsn\s?\d?|sportsnet|sn\s?1|sn360|espn\+?|tnt|abc|nbc|cbc|msg\s?\d?|nesn|bally|fanduel|altitude|prime)\b/,
    /hockey night/,
    /(^|[\/_-])(us|usa|uk|gb|en|ca)\.(png|gif|svg|jpe?g|webp)/,
  ],
  ru: [/\b(ru|rus|russian)\b/, /[а-яё]{3,}/],
};

export function detectLanguage(...texts) {
  const s = fold(texts.filter(Boolean).join(' '));
  let best = 'other';
  let bestScore = 0;
  for (const [lang, pats] of Object.entries(LANG_PATTERNS)) {
    const score = pats.reduce((n, re) => n + (re.test(s) ? 1 : 0), 0);
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }
  return best;
}

export function matchesTeam(text, keywords) {
  const s = fold(text);
  return keywords.some((k) => new RegExp(`(^|[^a-z])${fold(k)}([^a-z]|$)`).test(s));
}

const NOT_STREAMS = /(twitter|x\.com|facebook|instagram|telegram|t\.me|discord|reddit|youtube\.com\/(?!embed)|tiktok|mailto:|javascript:|google\.|apple\.com|play\.google)/i;

// links : [{ href, text, title, imgs, context, header }] (voir extractLinks)
export function rankStreams(links, { keywords, languagePriority = ['fr', 'en', 'other'], homeUrl = '' } = {}) {
  const seen = new Set();
  const out = [];
  const home = homeUrl.replace(/\/+$/, '');
  links.forEach((l, order) => {
    if (!l?.href || !/^https?:/i.test(l.href) || NOT_STREAMS.test(l.href)) return;
    const href = l.href.replace(/#.*$/, '');
    if (href.replace(/\/+$/, '') === home || seen.has(href)) return;
    if (!matchesTeam(`${l.context ?? ''} ${l.header ?? ''} ${l.text ?? ''} ${l.title ?? ''}`, keywords)) return;
    seen.add(href);
    let lang = detectLanguage(l.text, l.title, l.imgs, href);
    if (lang === 'other') lang = detectLanguage(l.context);
    let host = '';
    try {
      host = new URL(href).hostname.replace(/^www\./, '');
    } catch {
      return;
    }
    const label = (l.text || l.title || '').replace(/\s+/g, ' ').trim().slice(0, 40) || host;
    out.push({ url: href, label, lang, host, order, source: 'onhockey' });
  });
  const rank = (lang) => {
    const i = languagePriority.indexOf(lang);
    return i < 0 ? languagePriority.indexOf('other') + 0.5 : i;
  };
  return out.sort((a, b) => rank(a.lang) - rank(b.lang) || a.order - b.order);
}

// Stream de secours : le mieux classé qui n'est pas en panne (ou dont la pénalité est expirée).
export function pickNextStream(streams, currentIndex, failedAt, now, cooldownMs) {
  let fallback = -1;
  let oldest = Infinity;
  for (let i = 0; i < streams.length; i++) {
    if (i === currentIndex) continue;
    const f = failedAt.get(streams[i].url);
    if (f == null || now - f >= cooldownMs) return i;
    if (f < oldest) {
      oldest = f;
      fallback = i;
    }
  }
  return fallback;
}

// Extraction des liens depuis un Document (DOMParser ou page vivante).
export function extractLinks(doc, baseUrl) {
  const out = [];
  const els = doc.querySelectorAll('a[href], iframe[src], [data-href], [data-src], [data-url], [onclick]');
  for (const el of els) {
    let href =
      el.getAttribute('href') ||
      el.getAttribute('src') ||
      el.getAttribute('data-href') ||
      el.getAttribute('data-src') ||
      el.getAttribute('data-url') ||
      '';
    const onclick = el.getAttribute('onclick');
    if ((!href || href.startsWith('#') || href.startsWith('javascript')) && onclick) {
      const m = onclick.match(/['"]((?:https?:)?\/\/[^'"\s]+|[^'"\s]+\.(?:php|html?)(?:\?[^'"\s]*)?)['"]/);
      if (m) href = m[1];
    }
    if (!href || href.startsWith('#') || /^javascript:/i.test(href)) continue;
    let url;
    try {
      url = new URL(href, baseUrl).href;
    } catch {
      continue;
    }
    const row = el.closest('tr, li, dd, [class*="match"], [class*="game"], [class*="event"], [class*="row"]') ?? el.parentElement;
    const imgs = [...el.querySelectorAll('img'), ...(el.parentElement?.querySelectorAll(':scope > img') ?? [])]
      .map((i) => `${i.getAttribute('alt') ?? ''} ${i.getAttribute('title') ?? ''} ${i.getAttribute('src') ?? ''}`)
      .join(' ');
    const context = squash(row?.textContent).slice(0, 400);
    out.push({
      href: url,
      text: squash(el.textContent).slice(0, 80),
      title: el.getAttribute('title') ?? '',
      imgs: `${imgs} ${el.className ?? ''}`,
      context,
      // Si la ligne a déjà son propre titre de match, on n'emprunte pas celui d'une ligne au-dessus
      header: looksLikeGame(context) ? '' : findHeader(row),
    });
  }
  return out;
}

function squash(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function looksLikeGame(t) {
  return /\S\s(-|–|vs\.?|@|v)\s\S/i.test(t);
}

// Dans les tableaux "titre du match puis lignes de liens", le titre est une ligne précédente.
function findHeader(row) {
  let el = row?.previousElementSibling;
  for (let i = 0; el && i < 12; i++, el = el.previousElementSibling) {
    const t = squash(el.textContent);
    if (looksLikeGame(t) && t.length < 200) return t;
  }
  return '';
}
