namespace GSM3.Models;

public class SystemStats
{
    public CpuStats Cpu { get; set; } = new();
    public MemoryStats Memory { get; set; } = new();
    public DiskStats Disk { get; set; } = new();
    public NetworkStats Network { get; set; } = new();
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
}

public class CpuStats
{
    public double UsagePercent { get; set; }
    public int CoreCount { get; set; }
    public string ModelName { get; set; } = "";
    public double[] CoreUsages { get; set; } = Array.Empty<double>();
}

public class MemoryStats
{
    public long TotalBytes { get; set; }
    public long UsedBytes { get; set; }
    public long AvailableBytes { get; set; }
    public double UsagePercent { get; set; }
}

public class DiskStats
{
    public string DriveName { get; set; } = "";
    public long TotalBytes { get; set; }
    public long UsedBytes { get; set; }
    public long FreeBytes { get; set; }
    public double UsagePercent { get; set; }
}

public class NetworkStats
{
    public string InterfaceName { get; set; } = "";
    public long BytesSent { get; set; }
    public long BytesReceived { get; set; }
    public long SendSpeed { get; set; }
    public long ReceiveSpeed { get; set; }
}

public class ProcessInfo
{
    public int Pid { get; set; }
    public string Name { get; set; } = "";
    public double CpuPercent { get; set; }
    public long MemoryBytes { get; set; }
    public string User { get; set; } = "";
    public DateTime StartTime { get; set; }
}

public class ActivePort
{
    public string Protocol { get; set; } = "";
    public string LocalAddress { get; set; } = "";
    public int LocalPort { get; set; }
    public string State { get; set; } = "";
    public int Pid { get; set; }
    public string ProcessName { get; set; } = "";
}
