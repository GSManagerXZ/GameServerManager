namespace GSM3.Services;

/// <summary>
/// Simple 5-field cron expression parser (minute hour day-of-month month day-of-week).
/// Supports: * (any), specific values, ranges (1-5), steps (*/5, 1-30/5), lists (1,3,5).
/// Day-of-week: 0=Sunday .. 6=Saturday (7 is also accepted as Sunday).
/// </summary>
public static class CronParser
{
    /// <summary>
    /// Returns the next occurrence of the cron schedule strictly after <paramref name="from"/>.
    /// Scans up to 4 years ahead; throws if no match is found (e.g. impossible expression).
    /// </summary>
    public static DateTime GetNextOccurrence(string cronExpression, DateTime from)
    {
        var fields = Parse(cronExpression);
        // Start from the next minute boundary
        var dt = new DateTime(from.Year, from.Month, from.Day, from.Hour, from.Minute, 0).AddMinutes(1);
        var limit = from.AddYears(4);

        while (dt <= limit)
        {
            if (!fields.Months.Contains(dt.Month))
            {
                // Jump to first day of next month
                dt = new DateTime(dt.Year, dt.Month, 1).AddMonths(1);
                continue;
            }

            if (!fields.DaysOfMonth.Contains(dt.Day) || !fields.DaysOfWeek.Contains((int)dt.DayOfWeek))
            {
                dt = dt.Date.AddDays(1);
                continue;
            }

            if (!fields.Hours.Contains(dt.Hour))
            {
                dt = new DateTime(dt.Year, dt.Month, dt.Day, dt.Hour, 0, 0).AddHours(1);
                continue;
            }

            if (!fields.Minutes.Contains(dt.Minute))
            {
                dt = dt.AddMinutes(1);
                continue;
            }

            return dt;
        }

        throw new InvalidOperationException(
            $"No matching occurrence found within 4 years for cron expression: {cronExpression}");
    }

    /// <summary>
    /// Tests whether <paramref name="time"/> matches the cron expression (ignoring seconds).
    /// </summary>
    public static bool IsMatch(string cronExpression, DateTime time)
    {
        var fields = Parse(cronExpression);
        return fields.Minutes.Contains(time.Minute)
            && fields.Hours.Contains(time.Hour)
            && fields.DaysOfMonth.Contains(time.Day)
            && fields.Months.Contains(time.Month)
            && fields.DaysOfWeek.Contains((int)time.DayOfWeek);
    }

    /// <summary>
    /// Returns a human-readable Chinese description of the cron expression.
    /// Examples: "每5分钟", "每天 09:00", "每周一 08:30", "每月1日 00:00".
    /// </summary>
    public static string GetDescription(string cronExpression)
    {
        var parts = cronExpression.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 5)
            return cronExpression;

        var minute = parts[0];
        var hour = parts[1];
        var dom = parts[2];
        var month = parts[3];
        var dow = parts[4];

        // Every N minutes: */N * * * *
        if (minute.StartsWith("*/") && hour == "*" && dom == "*" && month == "*" && dow == "*")
            return $"每{minute[2..]}分钟";

        // Every N hours: 0 */N * * *
        if (minute == "0" && hour.StartsWith("*/") && dom == "*" && month == "*" && dow == "*")
            return $"每{hour[2..]}小时";

        // Build time string
        string timeStr = FormatTime(minute, hour);

        // Specific month + day: M D H M *
        if (month != "*" && dom != "*" && dow == "*")
            return $"每年{month}月{dom}日 {timeStr}";

        // Specific day of month: M * DOM * *
        if (dom != "*" && month == "*" && dow == "*")
            return $"每月{dom}日 {timeStr}";

        // Specific day of week: M H * * DOW
        if (dow != "*" && dom == "*" && month == "*")
        {
            var dowDesc = FormatDayOfWeek(dow);
            return $"每周{dowDesc} {timeStr}";
        }

        // Every day at specific time: M H * * *
        if (dom == "*" && month == "*" && dow == "*")
        {
            if (minute == "*" && hour == "*")
                return "每分钟";
            if (minute == "*")
                return $"每小时（{hour}时）";
            return $"每天 {timeStr}";
        }

        // Fallback: return the raw expression
        return cronExpression;
    }

    // ── Internal parsing ────────────────────────────────────────────────

    private static CronFields Parse(string cronExpression)
    {
        var parts = cronExpression.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 5)
            throw new FormatException($"Cron expression must have exactly 5 fields, got {parts.Length}: {cronExpression}");

        return new CronFields
        {
            Minutes = ParseField(parts[0], 0, 59),
            Hours = ParseField(parts[1], 0, 23),
            DaysOfMonth = ParseField(parts[2], 1, 31),
            Months = ParseField(parts[3], 1, 12),
            DaysOfWeek = NormalizeDow(ParseField(parts[4], 0, 7)),
        };
    }

    /// <summary>
    /// Parses a single cron field (supports *, values, ranges, steps, lists).
    /// </summary>
    private static HashSet<int> ParseField(string field, int min, int max)
    {
        var result = new HashSet<int>();

        foreach (var item in field.Split(','))
        {
            var token = item.Trim();
            if (string.IsNullOrEmpty(token))
                throw new FormatException($"Empty token in cron field: {field}");

            // Check for step: */N or A-B/N or A/N
            int step = 1;
            var slashIdx = token.IndexOf('/');
            if (slashIdx >= 0)
            {
                step = int.Parse(token[(slashIdx + 1)..]);
                if (step <= 0) throw new FormatException($"Step must be positive: {token}");
                token = token[..slashIdx];
            }

            if (token == "*")
            {
                for (int i = min; i <= max; i += step)
                    result.Add(i);
            }
            else if (token.Contains('-'))
            {
                var rangeParts = token.Split('-');
                int rangeStart = int.Parse(rangeParts[0]);
                int rangeEnd = int.Parse(rangeParts[1]);
                for (int i = rangeStart; i <= rangeEnd; i += step)
                    result.Add(i);
            }
            else
            {
                int val = int.Parse(token);
                if (slashIdx >= 0)
                {
                    // e.g. 5/10 means starting at 5, every 10
                    for (int i = val; i <= max; i += step)
                        result.Add(i);
                }
                else
                {
                    result.Add(val);
                }
            }
        }

        return result;
    }

    /// <summary>
    /// Normalize day-of-week: treat 7 as 0 (both mean Sunday).
    /// </summary>
    private static HashSet<int> NormalizeDow(HashSet<int> dow)
    {
        if (dow.Remove(7))
            dow.Add(0);
        return dow;
    }

    private static string FormatTime(string minuteField, string hourField)
    {
        // Attempt to produce HH:mm; fall back to raw tokens.
        if (int.TryParse(hourField, out var h) && int.TryParse(minuteField, out var m))
            return $"{h:D2}:{m:D2}";
        return $"{hourField}:{minuteField}";
    }

    private static string FormatDayOfWeek(string dowField)
    {
        // Map numeric day-of-week to Chinese name
        string[] names = ["日", "一", "二", "三", "四", "五", "六"];

        if (int.TryParse(dowField, out var d))
        {
            if (d == 7) d = 0;
            return d >= 0 && d <= 6 ? names[d] : dowField;
        }

        // Handle lists: 1,3,5 -> 一、三、五
        if (dowField.Contains(','))
        {
            var parts = dowField.Split(',')
                .Select(p => int.TryParse(p.Trim(), out var v) && v >= 0 && v <= 6 ? names[v] : p.Trim());
            return string.Join("、", parts);
        }

        return dowField;
    }

    private struct CronFields
    {
        public HashSet<int> Minutes;
        public HashSet<int> Hours;
        public HashSet<int> DaysOfMonth;
        public HashSet<int> Months;
        public HashSet<int> DaysOfWeek;
    }
}
