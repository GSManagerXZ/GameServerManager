namespace GSM3.Services;

using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using GSM3.Models;

public class SchedulerManager : IDisposable
{
    private static readonly string DataDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GSM3");
    private static readonly string TasksPath = Path.Combine(DataDir, "tasks.json");

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly ConcurrentDictionary<string, ScheduledTask> _tasks = new();
    private readonly InstanceManager _instanceManager;
    private readonly BackupManager _backupManager;
    private readonly SemaphoreSlim _saveLock = new(1, 1);
    private Timer? _checkTimer;

    public event EventHandler<ScheduledTaskEventArgs>? OnTaskExecuted;

    public SchedulerManager(InstanceManager instanceManager, BackupManager backupManager)
    {
        _instanceManager = instanceManager;
        _backupManager = backupManager;
    }

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(DataDir);

        if (File.Exists(TasksPath))
        {
            try
            {
                var json = await File.ReadAllTextAsync(TasksPath);
                var tasks = JsonSerializer.Deserialize<List<ScheduledTask>>(json, JsonOptions);
                if (tasks != null)
                {
                    foreach (var task in tasks)
                    {
                        task.NextRun = GetNextRun(task.CronExpression);
                        _tasks[task.Id] = task;
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Failed to load tasks: {ex.Message}");
            }
        }

        // Check every 30 seconds for tasks due
        _checkTimer = new Timer(_ => _ = CheckAndExecuteAsync(), null, TimeSpan.Zero, TimeSpan.FromSeconds(30));
    }

    public async Task<ScheduledTask> CreateTaskAsync(ScheduledTask task)
    {
        task.Id = Guid.NewGuid().ToString();
        task.CreatedAt = DateTime.UtcNow;
        task.NextRun = GetNextRun(task.CronExpression);

        _tasks[task.Id] = task;
        await SaveAsync();
        return task;
    }

    public async Task<ScheduledTask?> UpdateTaskAsync(ScheduledTask updated)
    {
        if (!_tasks.ContainsKey(updated.Id))
            return null;

        updated.NextRun = GetNextRun(updated.CronExpression);
        _tasks[updated.Id] = updated;
        await SaveAsync();
        return updated;
    }

    public async Task<bool> DeleteTaskAsync(string taskId)
    {
        if (!_tasks.TryRemove(taskId, out _))
            return false;

        await SaveAsync();
        return true;
    }

    public async Task<bool> ToggleTaskAsync(string taskId)
    {
        if (!_tasks.TryGetValue(taskId, out var task))
            return false;

        task.Enabled = !task.Enabled;
        if (task.Enabled)
            task.NextRun = GetNextRun(task.CronExpression);

        await SaveAsync();
        return true;
    }

    public List<ScheduledTask> GetTasks() => _tasks.Values.ToList();

    public async Task<bool> ExecuteNowAsync(string taskId)
    {
        if (!_tasks.TryGetValue(taskId, out var task))
            return false;

        await ExecuteTaskAsync(task);
        return true;
    }

    // ── Execution ──────────────────────────────────────────────

    private async Task CheckAndExecuteAsync()
    {
        var now = DateTime.UtcNow;
        foreach (var task in _tasks.Values.Where(t => t.Enabled && t.NextRun.HasValue && t.NextRun <= now))
        {
            await ExecuteTaskAsync(task);
        }
    }

    private async Task ExecuteTaskAsync(ScheduledTask task)
    {
        string? error = null;
        try
        {
            switch (task.Type)
            {
                case TaskType.Power:
                    if (task.PowerActionType.HasValue)
                    {
                        switch (task.PowerActionType.Value)
                        {
                            case PowerAction.Start:
                                await _instanceManager.StartInstanceAsync(task.InstanceId);
                                break;
                            case PowerAction.Stop:
                                await _instanceManager.StopInstanceAsync(task.InstanceId);
                                break;
                            case PowerAction.Restart:
                                await _instanceManager.RestartInstanceAsync(task.InstanceId);
                                break;
                        }
                    }
                    break;

                case TaskType.Command:
                    if (!string.IsNullOrEmpty(task.Command))
                    {
                        _instanceManager.SendInput(task.InstanceId, task.Command);
                    }
                    break;

                case TaskType.Backup:
                    var result = await _backupManager.CreateBackupAsync(task.InstanceId, $"Scheduled: {task.Name}");
                    if (!result.Success)
                        error = result.Error;
                    break;

                case TaskType.System:
                    // System actions (e.g., update) handled externally
                    break;
            }
        }
        catch (Exception ex)
        {
            error = ex.Message;
            Debug.WriteLine($"Task {task.Id} execution failed: {ex.Message}");
        }

        task.LastRun = DateTime.UtcNow;
        task.NextRun = GetNextRun(task.CronExpression);
        await SaveAsync();

        OnTaskExecuted?.Invoke(this, new ScheduledTaskEventArgs(task.Id, task.Name, task.Type, error));
    }

    // ── Cron Parsing ───────────────────────────────────────────
    // Format: minute hour day month dayOfWeek
    // Supports: *, specific values, ranges (1-5), steps (*/5), lists (1,3,5)

    private static DateTime? GetNextRun(string cronExpression)
    {
        try
        {
            var parts = cronExpression.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length != 5) return null;

            var now = DateTime.UtcNow;
            var candidate = new DateTime(now.Year, now.Month, now.Day, now.Hour, now.Minute, 0, DateTimeKind.Utc)
                .AddMinutes(1);

            // Search up to 1 year ahead
            var limit = candidate.AddYears(1);
            while (candidate < limit)
            {
                if (MatchesCron(candidate, parts))
                    return candidate;
                candidate = candidate.AddMinutes(1);
            }

            return null;
        }
        catch
        {
            return null;
        }
    }

    private static bool MatchesCron(DateTime dt, string[] parts)
    {
        return MatchesField(parts[0], dt.Minute, 0, 59) &&
               MatchesField(parts[1], dt.Hour, 0, 23) &&
               MatchesField(parts[2], dt.Day, 1, 31) &&
               MatchesField(parts[3], dt.Month, 1, 12) &&
               MatchesField(parts[4], (int)dt.DayOfWeek, 0, 6);
    }

    private static bool MatchesField(string field, int value, int min, int max)
    {
        if (field == "*") return true;

        foreach (var part in field.Split(','))
        {
            if (part.Contains('/'))
            {
                var stepParts = part.Split('/');
                var baseRange = stepParts[0];
                if (!int.TryParse(stepParts[1], out var step) || step <= 0) continue;

                int start = baseRange == "*" ? min : int.Parse(baseRange);
                for (var i = start; i <= max; i += step)
                {
                    if (i == value) return true;
                }
            }
            else if (part.Contains('-'))
            {
                var rangeParts = part.Split('-');
                var low = int.Parse(rangeParts[0]);
                var high = int.Parse(rangeParts[1]);
                if (value >= low && value <= high) return true;
            }
            else
            {
                if (int.TryParse(part, out var exact) && exact == value)
                    return true;
            }
        }

        return false;
    }

    // ── Persistence ────────────────────────────────────────────

    private async Task SaveAsync()
    {
        await _saveLock.WaitAsync();
        try
        {
            var json = JsonSerializer.Serialize(_tasks.Values.ToList(), JsonOptions);
            await File.WriteAllTextAsync(TasksPath, json);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to save tasks: {ex.Message}");
        }
        finally
        {
            _saveLock.Release();
        }
    }

    public void Dispose()
    {
        _checkTimer?.Dispose();
        _checkTimer = null;
        GC.SuppressFinalize(this);
    }
}

public class ScheduledTaskEventArgs : EventArgs
{
    public string TaskId { get; }
    public string TaskName { get; }
    public TaskType TaskType { get; }
    public string? Error { get; }

    public ScheduledTaskEventArgs(string taskId, string taskName, TaskType taskType, string? error)
    {
        TaskId = taskId;
        TaskName = taskName;
        TaskType = taskType;
        Error = error;
    }
}
