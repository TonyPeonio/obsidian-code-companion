import { describe, expect, it } from "vitest";
import { formatDate, formatDelta, humanAge, isoWeek, isoWeekDates, isoWeekLabel, isoWeekMonday, localDay, parseIsoWeekLabel, previousIsoWeek, startOfDay, thousands, toLocalIso } from "../src/core/dates";

describe("ISO weeks", () => {
	it("computes the ISO week of ordinary and edge dates", () => {
		expect(isoWeekLabel(isoWeek("2026-11-07"))).toBe("2026-W45");
		expect(isoWeekLabel(isoWeek("2026-01-01"))).toBe("2026-W01");
		expect(isoWeekLabel(isoWeek("2027-01-01"))).toBe("2026-W53");
		expect(isoWeekLabel(isoWeek("2024-12-30"))).toBe("2025-W01");
		expect(isoWeekLabel(isoWeek("2021-01-03"))).toBe("2020-W53");
	});

	it("knows the Monday and the seven dates of a week", () => {
		expect(isoWeekMonday({ year: 2026, week: 45 })).toBe("2026-11-02");
		expect(isoWeekMonday({ year: 2025, week: 1 })).toBe("2024-12-30");
		const dates = isoWeekDates({ year: 2026, week: 45 });
		expect(dates).toHaveLength(7);
		expect(dates[0]).toBe("2026-11-02");
		expect(dates[6]).toBe("2026-11-08");
	});

	it("steps back across a year boundary", () => {
		expect(previousIsoWeek({ year: 2026, week: 1 })).toEqual({ year: 2025, week: 52 });
		expect(previousIsoWeek({ year: 2026, week: 45 })).toEqual({ year: 2026, week: 44 });
	});

	it("parses labels", () => {
		expect(parseIsoWeekLabel("2026-W45")).toEqual({ year: 2026, week: 45 });
		expect(parseIsoWeekLabel("2026-W60")).toBeUndefined();
		expect(parseIsoWeekLabel("week 45")).toBeUndefined();
	});
});

describe("formatting", () => {
	it("formats dates with moment-style tokens and literal brackets", () => {
		expect(formatDate("2026-11-07", "YYYY-MM-DD")).toBe("2026-11-07");
		expect(formatDate("2026-11-07", "YYYY/MM/YYYY-MM-DD ddd")).toBe("2026/11/2026-11-07 Sat");
		expect(formatDate("2026-03-05", "[Daily] D MMM YY, dddd")).toBe("Daily 5 Mar 26, Thursday");
		expect(formatDate("2026-03-05", "MMMM D")).toBe("March 5");
	});

	it("renders local midnight with the machine's offset and reads the author's day", () => {
		const s = startOfDay("2026-11-07");
		expect(s.startsWith("2026-11-07T00:00:00")).toBe(true);
		expect(s).toMatch(/[+-]\d{2}:\d{2}$/);
		expect(Date.parse(s)).toBe(new Date(2026, 10, 7).getTime());
		expect(toLocalIso(new Date(2026, 0, 2, 3, 4, 5))).toMatch(/^2026-01-02T03:04:05[+-]\d{2}:\d{2}$/);
		expect(localDay("2026-11-06T23:30:00-07:00")).toBe("2026-11-06");
	});

	it("formats numbers and ages", () => {
		expect(thousands(1234567)).toBe("1,234,567");
		expect(formatDelta(120, 45)).toBe("+120 −45");
		const now = Date.parse("2026-11-07T12:00:00Z");
		expect(humanAge(now - 3600_000, now)).toBe("today");
		expect(humanAge(now - 3 * 86_400_000, now)).toBe("3 days");
		expect(humanAge(now - 70 * 86_400_000, now)).toBe("2 months");
		expect(humanAge(now - 400 * 86_400_000, now)).toBe("1 year");
	});
});
