interface ParsedInput {
  title: string;
  type: 'task' | 'event' | 'note';
  dueDate: Date | null;
  startTime: Date | null;
  priority: 'urgent' | 'high' | 'low' | null;
}

export function parseNaturalInput(text: string): ParsedInput {
  const result: ParsedInput = {
    title: text.trim(),
    type: 'task',
    dueDate: null,
    startTime: null,
    priority: null,
  };
  let cleanTitle = text.trim();
  const now = new Date();

  // Date detection
  const todayMatch = cleanTitle.match(/\b(today)\b/i);
  const tomorrowMatch = cleanTitle.match(/\b(tomorrow)\b/i);
  const nextDayMatch = cleanTitle.match(
    /\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  );
  const inDaysMatch = cleanTitle.match(/\bin\s+(\d+)\s+days?\b/i);
  const monthDayMatch = cleanTitle.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})\b/i,
  );

  if (todayMatch) {
    result.dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    cleanTitle = cleanTitle.replace(todayMatch[0], '').trim();
  } else if (tomorrowMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    result.dueDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    cleanTitle = cleanTitle.replace(tomorrowMatch[0], '').trim();
  } else if (nextDayMatch) {
    const dayNames = [
      'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
    ];
    const targetDay = dayNames.indexOf(nextDayMatch[1].toLowerCase());
    const d = new Date(now);
    const diff = (targetDay - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    result.dueDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    cleanTitle = cleanTitle.replace(nextDayMatch[0], '').trim();
  } else if (inDaysMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() + parseInt(inDaysMatch[1], 10));
    result.dueDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    cleanTitle = cleanTitle.replace(inDaysMatch[0], '').trim();
  } else if (monthDayMatch) {
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const month = months[monthDayMatch[1].toLowerCase()];
    const day = parseInt(monthDayMatch[2], 10);
    let year = now.getFullYear();
    const candidate = new Date(year, month, day);
    if (candidate < now) year++;
    result.dueDate = new Date(year, month, day);
    cleanTitle = cleanTitle.replace(monthDayMatch[0], '').trim();
  }

  // Time detection
  const timeMatch = cleanTitle.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch[3]?.toLowerCase();
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
    const base = result.dueDate || new Date(now.getFullYear(), now.getMonth(), now.getDate());
    result.startTime = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes);
    if (!result.dueDate) {
      result.dueDate = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    }
    cleanTitle = cleanTitle.replace(timeMatch[0], '').trim();
  }

  // Type detection
  if (/\b(meeting|call|appointment|lunch|dinner|interview|conference)\b/i.test(cleanTitle)) {
    result.type = 'event';
  } else if (/\b(note|remember that|fyi)\b/i.test(cleanTitle)) {
    result.type = 'note';
  }

  // Priority detection
  if (/\b(urgent|asap)\b/i.test(cleanTitle)) {
    result.priority = 'urgent';
    cleanTitle = cleanTitle.replace(/\b(urgent|asap)\b/i, '').trim();
  } else if (/\b(important|high priority)\b/i.test(cleanTitle)) {
    result.priority = 'high';
    cleanTitle = cleanTitle.replace(/\b(important|high priority)\b/i, '').trim();
  } else if (/\b(low priority)\b/i.test(cleanTitle)) {
    result.priority = 'low';
    cleanTitle = cleanTitle.replace(/\b(low priority)\b/i, '').trim();
  }

  result.title = cleanTitle.replace(/\s+/g, ' ').trim();
  return result;
}