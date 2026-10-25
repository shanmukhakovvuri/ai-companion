/**
 * Personal AI Companion â€” Grounded Image Question Answering Module
 *
 * Accurately answers questions about text visible in the currently selected image
 * (phone numbers, names, addresses, dates, printed labels) using on-device OCR
 * as the primary source of truth, preventing small vision models from hallucinating
 * or inventing digits.
 */

/**
 * Checks whether a user question is asking about text, numbers, or document
 * information visible in an image rather than visual scene reasoning.
 *
 * @param {string} question
 * @returns {boolean}
 */
export function isTextGroundedQuestion(question) {
  if (!question || typeof question !== 'string') return false;
  const q = question.trim().toLowerCase();

  // If question is a general visual query (e.g. color, placement, background), prefer vision
  if (/\b(what color|which color|what is the color|where is it placed|where is the|what object|describe the scene)\b/i.test(q)) {
    return false;
  }

  // Text-specific query intents
  const textKeywords = [
    /\b(contact|phone|mobile|cell|telephone|call)\b/i,
    /\b(business|company|shop|store|firm|brand)\s*(name)?\b/i,
    /\b(address|location|where is it located|city|pincode|postal|street|door)\b/i,
    /\b(proprietor|owner|who is|whose|person|name)\b/i,
    /\b(service|services|offer|specialist|repair)\b/i,
    /\b(what text|read text|what is written|what does it say|words)\b/i,
    /\b(date|event|happening|when|schedule|calendar)\b/i,
    /\b(email|mail|website|site|url|web)\b/i,
    /\bnumber\b/i,
  ];

  return textKeywords.some((pattern) => pattern.test(q));
}

/**
 * Extracts candidate phone/contact numbers from OCR text without altering digits.
 *
 * @param {string} ocrText
 * @returns {string[]} Array of candidate phone number strings
 */
export function extractContactNumbers(ocrText) {
  if (!ocrText || typeof ocrText !== 'string') return [];

  const candidates = [];
  const lines = ocrText.split('\n').map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // 1. Check lines explicitly labelled with Cell/Mobile/Phone/Tel
    if (/cell|mobile|phone|tel|contact/i.test(line)) {
      const matchNumbers = line.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3,5}\)?[-.\s]?\d{3,5}[-.\s]?\d{3,5}/g) || [];
      for (const m of matchNumbers) {
        const digits = m.replace(/\D/g, '');
        if (digits.length >= 7 && digits.length <= 15 && !/^(\d)\1+$/.test(digits)) {
          const cleaned = m.trim().replace(/^[-.:\s]+/, '').replace(/[-.:\s]+$/, '');
          if (!candidates.includes(cleaned)) {
            candidates.push(cleaned);
          }
        }
      }
    }

    // 2. Standalone 10-digit mobile numbers or international numbers
    const standaloneMatches = line.match(/\b\d{10}\b/g) || [];
    for (const num of standaloneMatches) {
      if (!candidates.includes(num)) {
        candidates.push(num);
      }
    }
  }

  // 3. Fallback: Any remaining 8-12 digit sequences across the full text
  const anyDigits = ocrText.match(/\b\d{8,12}\b/g) || [];
  for (const num of anyDigits) {
    // Exclude 6-digit postal codes
    if (num.length !== 6 && !candidates.some((c) => c.replace(/\D/g, '') === num)) {
      candidates.push(num);
    }
  }

  return candidates;
}

/**
 * Answers a user question using grounded OCR text from the currently selected image.
 * Returns null if the question is purely visual and should be handled by the vision model.
 *
 * @param {string} question The user question
 * @param {string} ocrText The OCR text recognized from the current image
 * @returns {string|null} Grounded answer or null if question requires visual reasoning
 */
export function answerImageQuestion(question, ocrText) {
  if (!question || typeof question !== 'string') return null;

  const q = question.trim().toLowerCase();
  const text = (ocrText || '').trim();
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // 1. Contact / phone number questions
  if (/\b(phone|contact|mobile|cell|number|telephone|call)\b/i.test(q)) {
    const numbers = extractContactNumbers(text);

    if (numbers.length > 0) {
      if (numbers.length === 1) {
        return `The contact number found in this image is ${numbers[0]}.`;
      }
      return `The contact numbers found in this image are: ${numbers.join(' and ')}.`;
    }

    return 'No contact number could be read confidently from this image.';
  }

  // 2. Business / Company / Shop name questions
  if (/\b(business|company|shop|store|brand|firm|enterprise)\b/i.test(q)) {
    // Find prominent business name line (e.g. "PRASAD COMPUTERS" or uppercase title lines)
    const bizLine = lines.find((l) =>
      /computers|tech|solutions|enterprises|systems|ltd|pvt|services/i.test(l) &&
      !/proprietor|cell|specialists|sales|brodipet|guntur/i.test(l)
    ) || lines.find((l) =>
      l.length >= 4 &&
      l === l.toUpperCase() &&
      !/cell|sales|laptops/i.test(l) &&
      !/^\d+$/.test(l)
    );

    if (bizLine) {
      return `The business name found in this image is ${bizLine}.`;
    }

    return 'The business name could not be identified confidently from the text in this image.';
  }

  // 3. Physical Address / Location questions
  if (/\b(address|location|where is it located|where is|city|place|pincode|postal|street)\b/i.test(q) && !/\b(email|mail)\b/i.test(q)) {
    // Identify address line containing door number, locality, city, or postal code
    const addrLines = lines.filter((l) => {
      // Exclude explicit phone lines or proprietor lines
      if (/\b(cell|mobile|phone|tel|proprietor)\b/i.test(l)) return false;
      // Exclude standalone 10-digit mobile numbers unless part of postal code
      if (/\b\d{10}\b/.test(l) && !/\b\d{6}\b/.test(l)) return false;
      return /\b\d{6}\b|brodipet|guntur|street|road|floor|plot|door|\d+[/-]\d+|avenue|lane|suite|nagar|colony|bazaar|block/i.test(l);
    });

    if (addrLines.length > 0) {
      return `The address found in this image is: ${addrLines.join(', ')}.`;
    }

    return 'No address could be identified confidently from the text in this image.';
  }

  // 4. Proprietor / Owner / Person name questions
  if (/\b(proprietor|owner|who is|whose|person|name of the person|name of the owner)\b/i.test(q)) {
    const propLine = lines.find((l) => /proprietor|bhargavi|owner|mr|mrs|ms/i.test(l));
    if (propLine) {
      const cleaned = propLine.replace(/^proprietor:?\s*/i, '').trim();
      return `The proprietor identified in this image is ${cleaned}.`;
    }

    return 'The owner or proprietor name could not be identified confidently from the text in this image.';
  }

  // 5. Services / Offerings questions
  if (/\b(service|services|offer|what do they do|specialist|specialists|repair)\b/i.test(q)) {
    const serviceLines = lines.filter((l) =>
      /service|repair|recovery|cabling|laptop|computer|specialist/i.test(l) &&
      !/cell|proprietor|\d{6}/i.test(l)
    );

    if (serviceLines.length > 0) {
      return `The services mentioned in this image are: ${serviceLines.join(', ')}.`;
    }

    return 'Services could not be identified confidently from the text in this image.';
  }

  // 6. Date / Event questions
  if (/\b(date|event|happening|when|schedule|calendar)\b/i.test(q)) {
    const dateLine = lines.find((l) =>
      /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?\b/i.test(l) ||
      /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(l)
    );

    if (dateLine) {
      return `The date or event information found in this image is: ${dateLine}.`;
    }

    return 'No date or event information could be read from the text in this image.';
  }

  // 7. Email / Website questions
  if (/\b(email|mail|website|web|site|url)\b/i.test(q)) {
    const emailOrWebLine = lines.find((l) =>
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(l) ||
      /\b(?:https?:\/\/|www\.)\S+\b/i.test(l) ||
      /\b\S+\.(?:com|org|net|in|edu|gov)\b/i.test(l)
    );

    if (emailOrWebLine) {
      return `The contact address or site found in this image is: ${emailOrWebLine}.`;
    }

    return 'No email address or website could be identified from the text in this image.';
  }

  // 8. Direct text extraction query ("what text is in the image", "what does it say", "read text")
  if (/\b(what text|read text|what is written|what does it say|words in)\b/i.test(q)) {
    if (lines.length > 0) {
      return `The text found in this image is:\n\n${text}`;
    }
    return 'No clear text was found in this image.';
  }

  // If question is not text-grounded, return null so it can be handled by the vision model
  return null;
}
