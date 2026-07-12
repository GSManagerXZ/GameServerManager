namespace GSM3.Models;

public enum TaskType { Power, Command, Backup, System }
public enum PowerAction { Start, Stop, Restart }

public class ScheduledTask
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "";
    public string InstanceId { get; set; } = "";
    public TaskType Type { get; set; }
    public string CronExpression { get; set; } = "";
    public bool Enabled { get; set; } = true;
    public PowerAction? PowerActionType { get; set; }
    public string? Command { get; set; }
    public string? SystemAction { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastRun { get; set; }
    public DateTime? NextRun { get; set; }
}
