namespace GSM3.Models;

public class BackupInfo
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string InstanceId { get; set; } = "";
    public string InstanceName { get; set; } = "";
    public string FileName { get; set; } = "";
    public string FilePath { get; set; } = "";
    public long FileSize { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
