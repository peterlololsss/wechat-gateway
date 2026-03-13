function tryParseJson(rawResult) {
  if (!rawResult || !['{', '['].includes(rawResult[0])) {
    return null;
  }

  try {
    return JSON.parse(rawResult);
  } catch {
    return null;
  }
}

function collectTextFragments(value, fragments) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      fragments.push(trimmed);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextFragments(item, fragments);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  const preferredKeys = ['text', 'ocrText', 'lineText', 'content'];
  for (const key of preferredKeys) {
    if (typeof value[key] === 'string') {
      collectTextFragments(value[key], fragments);
    }
  }

  for (const nestedValue of Object.values(value)) {
    if (typeof nestedValue === 'object') {
      collectTextFragments(nestedValue, fragments);
    }
  }
}

export function normalizeOcrResult(result) {
  const rawResult = String(result || '').trim();
  const parsedResult = tryParseJson(rawResult);
  const fragments = [];

  if (parsedResult) {
    collectTextFragments(parsedResult, fragments);
  } else if (rawResult) {
    for (const line of rawResult.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) {
        fragments.push(trimmed);
      }
    }
  }

  const lines = [...new Set(fragments)];

  return {
    raw_result: rawResult,
    parsed_result: parsedResult,
    lines,
    text: lines.join('\n') || rawResult,
  };
}
