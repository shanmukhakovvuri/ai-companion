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
  return typeof text === 'string'
    ? text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
    : '';
}

function isDescribeCommand(command) {
  return [
    /^(?:please )?(?:describe|explain)(?: (?:this|the|that))?(?: (?:image|photo|picture|scene|surroundings))?$/,
    /^(?:please )?(?:what is in|whats in|what can you see in|tell me what you see in|identify)(?: (?:this|the|that))?(?: (?:image|photo|picture|scene|surroundings))?$/,
    /^(?:please )?(?:describe something in front of me|what is in front of me|whats in front of me)$/,
  ].some((pattern) => pattern.test(command));
}

function isReadTextCommand(command) {
  return [
    /^(?:please )?(?:read|extract)(?: the)? text$/,
    /^(?:please )?(?:read|extract)(?: the)? text (?:from|in|on) (?:(?:this|the|that|a|an) )?(?:image|photo|picture|sign|document)$/,
    /^(?:please )?read (?:this|the|that) (?:image|photo|picture|sign|document)$/,
    /^(?:please )?read (?:this|the|that) text$/,
  ].some((pattern) => pattern.test(command));
}

function imageActionResult(action, options, messages) {
  if (!options.hasImage) {
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
 * @param {{ hasImage?: boolean, visionAvailable?: boolean, ocrAvailable?: boolean, language?: string }} [options]
 * @returns {{ action: string, status: string, params: object, message: string }}
 */
export function routeCommand(transcript, {
  hasImage = false,
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
      return imageActionResult('describe_image', { hasImage, available: visionAvailable }, messages);
    }
    if (localized.readText.some((phrase) => command.includes(phrase))) {
      return imageActionResult('read_text', { hasImage, available: ocrAvailable }, messages);
    }
  }

  const siteMatch = command.match(
    /^(?:(?:please|can you|could you) )?(?:open|launch|go to|visit|navigate to) (?:the )?(youtube|google)(?: (?:website|site|page))?$/,
  );

  if (siteMatch) {
    const siteId = siteMatch[1];
    return {
      action: 'open_site',
      status: 'ready',
      params: { siteId, url: ALLOWED_SITES[siteId] },
      message: language === 'hi-IN'
        ? `${siteId === 'youtube' ? 'यूट्यूब' : 'गूगल'} खोला जा रहा है।`
        : language === 'te-IN'
          ? `${siteId === 'youtube' ? 'యూట్యూబ్' : 'గూగుల్'} తెరుస్తున్నాను.`
          : `Opening ${siteId === 'youtube' ? 'YouTube' : 'Google'}.`,
    };
  }

  if (isDescribeCommand(command)) {
    return imageActionResult('describe_image', {
      hasImage,
      available: visionAvailable,
    }, messages);
  }

  if (isReadTextCommand(command)) {
    return imageActionResult('read_text', {
      hasImage,
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

/** Navigates in the current tab to a fixed, allowlisted website only. */
export function openAllowedSite(siteId) {
  if (!Object.hasOwn(ALLOWED_SITES, siteId)) {
    throw new Error('That website is not in the allowed list.');
  }
  if (!globalThis.window?.location?.assign) {
    throw new Error('Browser navigation is unavailable in this environment.');
  }

  globalThis.window.location.assign(ALLOWED_SITES[siteId]);
  return true;
}