/** Calendar dates as `YYYY-MM-DD` strings (UTC arithmetic so DST never shifts a day), ISO weeks, local timestamps. */

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const pad2 = (n: number): string => String(n).padStart(2, "0");

export function isIsoDate(s: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	const ms = toMs(s);
	return !Number.isNaN(ms) && fromMs(ms) === s;
}

function toMs(date: string): number {
	const [y, m, d] = date.split("-").map(Number);
	return Date.UTC(y, m - 1, d);
}

function fromMs(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
	return fromMs(toMs(date) + n * DAY_MS);
}

export function weekday(date: string): string {
	return WEEKDAYS[new Date(toMs(date)).getUTCDay()];
}

/** Today's local calendar date. */
export function today(now: Date = new Date()): string {
	return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** The calendar day of an ISO 8601 timestamp in the offset it was written with (`%aI` → the author's day). */
export function localDay(iso: string): string {
	return iso.slice(0, 10);
}

/** `2026-11-07T00:00:00-07:00`: a Date rendered in the machine's local offset. */
export function toLocalIso(d: Date): string {
	const off = -d.getTimezoneOffset();
	const sign = off >= 0 ? "+" : "-";
	const abs = Math.abs(off);
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** Local midnight at the start of `date`, as an ISO timestamp git's `--after` understands. */
export function startOfDay(date: string): string {
	const [y, m, d] = date.split("-").map(Number);
	return toLocalIso(new Date(y, m - 1, d, 0, 0, 0));
}

// ---------------------------------------------------------------- ISO weeks

export interface IsoWeek {
	year: number;
	week: number;
}

/** ISO 8601 week (Monday first; week 1 holds January 4th). */
export function isoWeek(date: string): IsoWeek {
	const d = new Date(toMs(date));
	const day = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - day);
	const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
	return { year: d.getUTCFullYear(), week: Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7) };
}

export function isoWeekLabel(w: IsoWeek): string {
	return `${w.year}-W${pad2(w.week)}`;
}

/** `2026-W45` → { 2026, 45 }; undefined when malformed. */
export function parseIsoWeekLabel(label: string): IsoWeek | undefined {
	const m = /^(\d{4})-W(\d{2})$/.exec(label.trim());
	if (!m) return undefined;
	const week = Number(m[2]);
	return week >= 1 && week <= 53 ? { year: Number(m[1]), week } : undefined;
}

export function isoWeekMonday(w: IsoWeek): string {
	const jan4 = new Date(Date.UTC(w.year, 0, 4));
	const day = jan4.getUTCDay() || 7;
	const mondayOfWeek1 = jan4.getTime() - (day - 1) * DAY_MS;
	return fromMs(mondayOfWeek1 + (w.week - 1) * 7 * DAY_MS);
}

/** The seven dates of the week, Monday first. */
export function isoWeekDates(w: IsoWeek): string[] {
	const monday = isoWeekMonday(w);
	return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** The ISO week before `w`. */
export function previousIsoWeek(w: IsoWeek): IsoWeek {
	return isoWeek(addDays(isoWeekMonday(w), -7));
}

// ---------------------------------------------------------------- formatting

/**
 * Moment-style date formatting for the subset daily-note users rely on:
 * `YYYY YY MMMM MMM MM M DD D dddd ddd`, with `[literal]` escapes. Other characters pass through.
 */
export function formatDate(date: string, format: string): string {
	const [y, m, d] = date.split("-").map(Number);
	const dow = new Date(toMs(date)).getUTCDay();
	const tokens: Record<string, string> = {
		YYYY: String(y),
		YY: pad2(y % 100),
		MMMM: MONTHS_LONG[m - 1],
		MMM: MONTHS[m - 1],
		MM: pad2(m),
		M: String(m),
		DD: pad2(d),
		D: String(d),
		dddd: WEEKDAYS_LONG[dow],
		ddd: WEEKDAYS[dow],
	};
	return format.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd/g, (tok, literal: string | undefined) => (literal !== undefined ? literal : tokens[tok]));
}

/** `1234` → `1,234`. */
export function thousands(n: number): string {
	return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** `+120 −45` (with a real minus sign). */
export function formatDelta(added: number, deleted: number): string {
	return `+${thousands(added)} −${thousands(deleted)}`;
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
	return `${thousands(n)} ${n === 1 ? word : pluralWord}`;
}

/** `Nov 6` for a commit line shown on another day. */
export function shortDate(date: string): string {
	const [, m, d] = date.split("-").map(Number);
	return `${MONTHS[m - 1]} ${d}`;
}

/** Rough age of a timestamp for the TODO table: `today`, `3 days`, `2 months`, `1 year`. */
export function humanAge(thenMs: number, nowMs: number): string {
	const days = Math.floor((nowMs - thenMs) / DAY_MS);
	if (days < 1) return "today";
	if (days < 30) return plural(days, "day");
	if (days < 365) return plural(Math.floor(days / 30), "month");
	return plural(Math.floor(days / 365), "year");
}
