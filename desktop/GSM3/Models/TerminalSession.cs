namespace GSM3.Models;

public class TerminalSession
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "";
    public string WorkingDirectory { get; set; } = "";
    public int? ProcessId { get; set; }
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
