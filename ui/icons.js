// Frank — Lucide icon SVG paths (24x24 viewBox)
// Each icon is a plain SVG string function. No React, no dependencies.

const PATHS = {
  'chevron-left': '<path d="M15 18l-6-6 6-6"/>',
  'chevron-right': '<path d="M9 18l6-6-6-6"/>',
  'x': '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>',
  'settings': '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'menu': '<path d="M4 12h16"/><path d="M4 6h16"/><path d="M4 18h16"/>',
  'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'share': '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/>',
  'pencil': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  'bell': '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  'map-pin': '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  'navigation': '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
  'home': '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  'user': '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  'heart': '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  'bookmark': '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  'clock': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'message-square': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  'shopping-cart': '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  'compass': '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  'bar-chart': '<path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/>',
  'camera': '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  'book-open': '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  'trending-up': '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  'star': '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  'grid': '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  'list': '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  'credit-card': '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
  'wallet': '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
  'send': '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  'phone': '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  'video': '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  'music': '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  'image': '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  'layout-dashboard': '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  'more-horizontal': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  'filter': '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  'upload': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  'globe': '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  'lock': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'unlock': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  'info': '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  'check': '<path d="M20 6 9 17l-5-5"/>',
  'trash': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  'refresh': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  'external-link': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  'mic': '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
  'headphones': '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
  'map': '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
  'inbox': '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
}

export function icon(name, size = 18) {
  const paths = PATHS[name] || ''
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
}

// Map a description string to an icon name (used by header and nav sections)
export function headerIcon(desc) {
  const d = desc.toLowerCase()
  if (/\bback\b/.test(d)) return icon('chevron-left')
  if (/\bforward\b/.test(d)) return icon('chevron-right')
  if (/\b(close|dismiss)\b/.test(d)) return icon('x')
  if (/\bsearch\b/.test(d)) return icon('search')
  if (/\b(menu|hamburger)\b/.test(d)) return icon('menu')
  if (/\b(add|plus|create|new)\b/.test(d)) return icon('plus')
  if (/\bshare\b/.test(d)) return icon('share')
  if (/\b(edit|pencil)\b/.test(d)) return icon('pencil')
  if (/\b(notif|bell|alert)\b/.test(d)) return icon('bell')
  if (/\bvideo\b/.test(d)) return icon('video')
  if (/\b(phone|call)\b/.test(d)) return icon('phone')
  if (/\bsend\b/.test(d)) return icon('send')
  if (/\bbookmark\b/.test(d)) return icon('bookmark')
  if (/\b(heart|like|love|fav)\b/.test(d)) return icon('heart')
  if (/\b(camera|photo)\b/.test(d)) return icon('camera')
  if (/\b(star|rating)\b/.test(d)) return icon('star')
  if (/\b(more|overflow|ellipsis|options)\b/.test(d)) return icon('more-horizontal')
  if (/\bfilter\b/.test(d)) return icon('filter')
  if (/\bdownload\b/.test(d)) return icon('download')
  if (/\bupload\b/.test(d)) return icon('upload')
  if (/\b(globe|web|browser)\b/.test(d)) return icon('globe')
  if (/\block\b/.test(d)) return icon('lock')
  if (/\bunlock\b/.test(d)) return icon('unlock')
  if (/\binfo\b/.test(d)) return icon('info')
  if (/\bsettings\b/.test(d)) return icon('settings')
  if (/\b(check|done|confirm)\b/.test(d)) return icon('check')
  if (/\b(delete|trash|remove)\b/.test(d)) return icon('trash')
  if (/\b(refresh|reload|sync)\b/.test(d)) return icon('refresh')
  if (/\b(external|link|open)\b/.test(d)) return icon('external-link')
  if (/\bmic\b/.test(d)) return icon('mic')
  if (/\b(headphone|audio)\b/.test(d)) return icon('headphones')
  if (/\bhome\b/.test(d)) return icon('home')
  if (/\buser\b/.test(d)) return icon('user')
  return ''
}

// Map a bottom-nav label to an icon name
export function navIcon(label) {
  const l = label.toLowerCase()
  if (/\bhome\b/.test(l)) return icon('home')
  if (/\bsearch\b|explore\b|discover\b/.test(l)) return icon('search')
  if (/\b(profile|account|me)\b/.test(l)) return icon('user')
  if (/\bsettings\b/.test(l)) return icon('settings')
  if (/\b(message|chat|inbox)\b/.test(l)) return icon('message-square')
  if (/\b(notif|bell|alert)\b/.test(l)) return icon('bell')
  if (/\b(heart|fav|like|saved)\b/.test(l)) return icon('heart')
  if (/\bbookmark\b/.test(l)) return icon('bookmark')
  if (/\b(cart|shop|store|buy)\b/.test(l)) return icon('shopping-cart')
  if (/\bcompass\b/.test(l)) return icon('compass')
  if (/\b(activity|chart|stats|analytics)\b/.test(l)) return icon('bar-chart')
  if (/\b(camera|photo)\b/.test(l)) return icon('camera')
  if (/\b(library|book|read)\b/.test(l)) return icon('book-open')
  if (/\b(wallet|pay|money)\b/.test(l)) return icon('wallet')
  if (/\b(music|audio|listen)\b/.test(l)) return icon('music')
  if (/\b(map|location|places)\b/.test(l)) return icon('map-pin')
  if (/\b(add|create|new|post|plus)\b/.test(l)) return icon('plus')
  if (/\b(grid|category|browse)\b/.test(l)) return icon('grid')
  if (/\b(file|document)\b/.test(l)) return icon('file-text')
  if (/\b(dashboard|overview)\b/.test(l)) return icon('layout-dashboard')
  if (/\bdirections?\b/.test(l)) return icon('navigation')
  if (/\brecents?\b|\bhistory\b/.test(l)) return icon('clock')
  if (/\btrend\b/.test(l)) return icon('trending-up')
  if (/\bfeed\b|\blist\b/.test(l)) return icon('list')
  if (/\bcard\b|\bpayment\b/.test(l)) return icon('credit-card')
  if (/\b(send|transfer)\b/.test(l)) return icon('send')
  if (/\b(phone|call)\b/.test(l)) return icon('phone')
  if (/\bvideo\b/.test(l)) return icon('video')
  if (/\b(image|gallery)\b/.test(l)) return icon('image')
  if (/\b(doc|file|note)\b/.test(l)) return icon('file-text')
  if (/\b(star|rating)\b/.test(l)) return icon('star')
  if (/\bshare\b/.test(l)) return icon('share')
  return icon('grid')
}
