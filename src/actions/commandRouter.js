export const ALLOWED_SITES = Object.freeze({
  youtube: 'https://www.youtube.com/',
  google: 'https://www.google.com/',
});

const localizedCommands = {
  'hi-IN': {
    sites: {
      youtube: ['यूट्यूब खोलो', 'यूट्यूब खोलिए', 'यूट्यूब पर जाओ'],
      google: ['गूगल खोलो', 'गूगल खोलिए', 'गूगल पर जाओ'],
    },
    describe: ['इस तस्वीर का वर्णन करो', 'इस फोटो का वर्णन करो', 'इस छवि का वर्णन करो', 'मेरे सामने क्या है'],
    readText: ['इस तस्वीर का पाठ पढ़ो', 'इस फोटो का टेक्स्ट पढ़ो', 'इस तस्वीर में लिखा पढ़ो', 'टेक्स्ट पढ़ो'],
    messages: {
      needsImage: 'पहले एक तस्वीर चुनें या कैमरे से लें।',
      describeUnavailable: 'अभी तस्वीर का वर्णन उपलब्ध नहीं है।',
      readUnavailable: 'तस्वीर से पाठ पढ़ना अभी उपलब्ध नहीं है।',
      describeReady: 'तस्वीर का वर्णन शुरू कर रहा हूँ।',
      readReady: 'तस्वीर से पाठ पढ़ना शुरू कर रहा हूँ।',
      unknown: 'मैं यह आदेश समझ नहीं पाया। “यूट्यूब खोलो” या “इस तस्वीर का वर्णन करो” कहें।',
    },
  },
  'te-IN': {
    sites: {
      youtube: ['యూట్యూబ్ తెరవండి', 'యూట్యూబ్ ఓపెన్ చేయండి', 'యూట్యూబ్‌కు వెళ్లండి'],
      google: ['గూగుల్ తెరవండి', 'గూగుల్ ఓపెన్ చేయండి', 'గూగుల్‌కు వెళ్లండి'],
    },
    describe: ['ఈ చిత్రాన్ని వివరించండి', 'ఈ ఫోటోను వివరించండి', 'నా ముందు ఏముంది'],
    readText: ['ఈ చిత్రంలోని వచనాన్ని చదవండి', 'ఈ ఫోటోలోని వచనాన్ని చదవండి', 'వచనాన్ని చదవండి'],
    messages: {
      needsImage: 'ముందుగా ఒక చిత్రాన్ని ఎంచుకోండి లేదా ఫోటో తీయండి.',
      describeUnavailable: 'చిత్ర వివరణ ప్రస్తుతం అందుబాటులో లేదు.',
      readUnavailable: 'చిత్రంలోని వచనాన్ని చదవడం ఇంకా అందుబాటులో లేదు.',
      describeReady: 'చిత్ర వివరణను ప్రారంభిస్తున్నాను.',
      readReady: 'చిత్రంలోని వచనాన్ని చదవడం ప్రారంభిస్తున్నాను.',
      unknown: 'ఆ ఆదేశం అర్థం కాలేదు. యూట్యూబ్ తెరవండి లేదా ఈ చిత్రాన్ని వివరించండి అని చెప్పండి.',
    },
  },
};

function normalizeCommand(text) {
  if (typeof text !== 'string') return '';
  let normalized = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  // Strip optional leading wake phrase so commands route cleanly with or without the wake phrase prefix
  normalized = normalized.replace(/^(?:hey|okay|ok)\s+companion\s+/, '');
  return normalized;
}

function isDescribeCommand(command) {
  return [
    /^(?:please )?(?:can you |could you )?(?:describe|explain)(?: (?:this|the|that))?(?: (?:image|photo|picture|scene|surroundings))?$/,
    /^(?:please )?(?:can you |could you )?(?:describe|tell me|explain) what (?:you see|is in front of me|is there)$/,
    /^(?:please )?(?:can you |could you )?(?:what is in|whats in|what can you see in|tell me what you see in|identify|what is|whats)(?: (?:this|the|that))?(?: (?:image|photo|picture|scene|surroundings))?$/,
    /^(?:please )?(?:describe something in front of me|what is in front of me|whats in front of me|what do you see|what can you see)$/,
  ].some((pattern) => pattern.test(command));
}

function isReadTextCommand(command) {
  return [
    /^(?:please )?(?:can you |could you )?(?:read|extract)(?: the)? text$/,
    /^(?:please )?(?:can you |could you )?(?:read|extract)(?: the)? text (?:from|in|on) (?:(?:this|the|that|a|an) )?(?:image|photo|picture|sign|document)$/,
    /^(?:please )?(?:can you |could you )?read (?:this|the|that) (?:image|photo|picture|sign|document)$/,
    /^(?:please )?(?:can you |could you )?read (?:this|the|that) text$/,
    /^(?:please )?(?:can you |could you )?read (?:the )?text from (?:this|the|that) (?:image|photo|picture|sign|document)$/,
  ].some((pattern) => pattern.test(command));
}

function imageActionResult(action, options, messages) {
  const hasSource = options.hasImage || options.canUseCamera;
  if (!hasSource) {
    return {
      action,
      status: 'needs_input',
      params: { requiresImage: true },
      message: messages.needsImage,
    };
  }

  if (!options.available) {
    return {
      action,
      status: 'unavailable',
      params: { requiresImage: true },
      message: action === 'describe_image' ? messages.describeUnavailable : messages.readUnavailable,
    };
  }

  return {
    action,
    status: 'ready',
    params: { requiresImage: true },
    message: action === 'describe_image' ? messages.describeReady : messages.readReady,
  };
}

/**
 * Converts recognized speech into a safe, structured action request.
 * Image actions only return requests; this function does not run AI or OCR.
 *
 * @param {string} transcript
 * @param {{ hasImage?: boolean, canUseCamera?: boolean, visionAvailable?: boolean, ocrAvailable?: boolean, language?: string }} [options]
 * @returns {{ action: string, status: string, params: object, message: string }}
 */
export function routeCommand(transcript, {
  hasImage = false,
  canUseCamera = false,
  visionAvailable = true,
  ocrAvailable = false,
  language = 'en-IN',
} = {}) {
  const command = normalizeCommand(transcript);
  const localized = localizedCommands[language];
  const messages = localized?.messages || {
    needsImage: 'Select or capture an image first, then ask again.',
    describeUnavailable: 'Image description is unavailable right now.',
    readUnavailable: 'Text reading is unavailable because no OCR module is connected yet.',
    describeReady: 'Image description requested.',
    readReady: 'Text reading requested.',
    unknown: 'I did not recognize that command. Try “Open YouTube,” “Describe this image,” or “Read text from this image.”',
  };

  if (localized) {
    const localizedSite = Object.entries(localized.sites)
      .find(([, phrases]) => phrases.some((phrase) => command.includes(phrase)));
    if (localizedSite) {
      const [siteId] = localizedSite;
      return {
        action: 'open_site',
        status: 'ready',
        params: { siteId, url: ALLOWED_SITES[siteId] },
        message: siteId === 'youtube'
          ? (language === 'hi-IN' ? 'यूट्यूब खोला जा रहा है।' : 'యూట్యూబ్ తెరుస్తున్నాను.' )
          : (language === 'hi-IN' ? 'गूगल खोला जा रहा है।' : 'గూగుల్ తెరుస్తున్నాను.'),
      };
    }
    if (localized.describe.some((phrase) => command.includes(phrase))) {
      return imageActionResult('describe_image', { hasImage, canUseCamera, available: visionAvailable }, messages);
    }
    if (localized.readText.some((phrase) => command.includes(phrase))) {
      return imageActionResult('read_text', { hasImage, canUseCamera, available: ocrAvailable }, messages);
    }
  }

  // 1. Supported site navigation (e.g., "Open YouTube in a new tab", "Open Google")
  const siteMatch = command.match(
    /^(?:(?:please|can you|could you) )?(?:open|launch|go to|visit|navigate to) (?:the )?(youtube|google)(?: (?:website|site|page|app))?(?: (?:in a new tab|in new tab|in a new window|in new window|in a tab|in tab))?$/,
  );

  if (siteMatch) {
    const siteId = siteMatch[1];
    const isNewTab = /new tab|new window|in a tab|in tab/.test(command) || true;
    const tabSuffix = /new tab|new window/.test(command) ? ' in a new tab' : '';
    return {
      action: 'open_site',
      status: 'ready',
      params: { siteId, url: ALLOWED_SITES[siteId], inNewTab: isNewTab },
      message: language === 'hi-IN'
        ? `${siteId === 'youtube' ? 'यूट्यूब' : 'गूगल'} खोला जा रहा है।`
        : language === 'te-IN'
          ? `${siteId === 'youtube' ? 'యూట్యూబ్' : 'గూగుల్'} తెరుస్తున్నాను.`
          : `Opening ${siteId === 'youtube' ? 'YouTube' : 'Google'}${tabSuffix}.`,
    };
  }

  // 2. Unsupported hardware/system controls (e.g. keyboard backlight, brightness, volume)
  const isHardwareCommand = [
    /\b(?:keyboard backlight|backlight|screen brightness|brightness|volume up|volume down|mute volume|unmute volume|shut ?down|restart (?:laptop|computer|pc)|sleep mode)\b/i,
    /\b(?:turn on|turn off|enable|disable|increase|decrease|adjust) (?:the |my )?(?:keyboard backlight|backlight|screen brightness|brightness|volume|laptop volume|fan speed)\b/i,
  ].some((pattern) => pattern.test(command));

  if (isHardwareCommand) {
    return {
      action: 'unsupported_hardware',
      status: 'unsupported',
      params: {},
      message: 'I cannot control laptop hardware or system settings from the browser. For security, web applications cannot adjust physical settings like keyboard backlighting or brightness.',
    };
  }

  // 3. Unsupported / unallowlisted website navigation
  const unallowlistedSiteMatch = command.match(
    /^(?:(?:please|can you|could you) )?(?:open|launch|go to|visit|navigate to) (?:the )?([a-z0-9_-]+)(?: (?:website|site|page|app))?(?: (?:in a new tab|in new tab|in a new window|in new window))?$/,
  );

  if (unallowlistedSiteMatch && !['camera', 'webcam', 'mic', 'microphone', 'image', 'photo', 'text', 'it', 'this', 'that'].includes(unallowlistedSiteMatch[1])) {
    const siteName = unallowlistedSiteMatch[1];
    return {
      action: 'unsupported_site',
      status: 'unsupported',
      params: { requestedSite: siteName },
      message: `I can only open allowlisted websites (YouTube and Google). Opening "${siteName}" is not permitted for security.`,
    };
  }

  if (isDescribeCommand(command)) {
    return imageActionResult('describe_image', {
      hasImage,
      canUseCamera,
      available: visionAvailable,
    }, messages);
  }

  if (isReadTextCommand(command)) {
    return imageActionResult('read_text', {
      hasImage,
      canUseCamera,
      available: ocrAvailable,
    }, messages);
  }

  return {
    action: 'unknown',
    status: 'unrecognized',
    params: {},
    message: messages.unknown,
  };
}

/**
 * Opens a fixed, allowlisted website.
 * Uses window.open with '_blank' and sets win.opener = null for reverse-tabnabbing protection.
 * Returns whether the browser permitted or blocked the popup.
 *
 * @param {string} siteId
 * @param {{ inNewTab?: boolean }} [options]
 * @returns {{ success: boolean, popupBlocked: boolean, url: string }}
 */
export function openAllowedSite(siteId, { inNewTab = true } = {}) {
  if (!Object.hasOwn(ALLOWED_SITES, siteId)) {
    throw new Error('That website is not in the allowed list.');
  }
  const url = ALLOWED_SITES[siteId];

  if (inNewTab) {
    if (typeof globalThis.window?.open !== 'function') {
      throw new Error('Browser popup / window navigation is unavailable in this environment.');
    }

    let win;
    try {
      // NOTE: We do not pass 'noopener' in the features string to window.open() because browsers
      // intentionally return null from window.open() when 'noopener' is set, which prevents
      // detecting whether the popup actually opened or was blocked.
      // Instead, we open with '_blank', verify the returned Window reference, and then
      // immediately set win.opener = null to prevent reverse-tabnabbing security vulnerabilities.
      win = globalThis.window.open(url, '_blank');
    } catch (err) {
      console.warn('window.open threw an error:', err);
      return { success: false, popupBlocked: true, url };
    }

    // If the browser popup blocker intervened, win will be null, undefined, or immediately closed
    if (!win || win.closed || typeof win.closed === 'undefined') {
      return { success: false, popupBlocked: true, url };
    }

    // Sever the opener relationship to prevent reverse-tabnabbing security vulnerabilities
    try {
      win.opener = null;
    } catch {
      // Ignore if browser security policy already isolated or restricted opener manipulation
    }

    return { success: true, popupBlocked: false, url };
  }

  if (!globalThis.window?.location?.assign) {
    throw new Error('Browser navigation is unavailable in this environment.');
  }

  globalThis.window.location.assign(url);
  return { success: true, popupBlocked: false, url };
}