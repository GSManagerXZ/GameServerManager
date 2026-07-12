namespace GSM3.Services;

using System.Diagnostics;
using System.Management;
using System.Net.NetworkInformation;
using GSM3.Models;

public class SystemMonitor : IDisposable
{
    private Timer? _timer;
    private readonly object _lock = new();
    private SystemStats _lastStats = new();
    private long _prevBytesSent;
    private long _prevBytesRecv;
    private DateTime _prevNetTime = DateTime.UtcNow;

    public event EventHandler<SystemStats>? OnStatsUpdated;

    public int IntervalMs { get; set; } = 5000;

    public void Start(int? intervalMs = null)
    {
        if (intervalMs.HasValue)
            IntervalMs = intervalMs.Value;

        _timer?.Dispose();
        _timer = new Timer(_ => CollectStats(), null, 0, IntervalMs);
    }

    public void Stop()
    {
        _timer?.Dispose();
        _timer = null;
    }

    public SystemStats GetLastStats()
    {
        lock (_lock) { return _lastStats; }
    }

    // ── CPU ────────────────────────────────────────────────────

    public async Task<CpuStats> GetCpuUsageAsync()
    {
        var cpuStats = new CpuStats
        {
            CoreCount = Environment.ProcessorCount
        };

        try
        {
            // Get CPU model name via WMI
            using var searcher = new ManagementObjectSearcher("SELECT Name FROM Win32_Processor");
            foreach (ManagementObject obj in searcher.Get())
            {
                cpuStats.ModelName = obj["Name"]?.ToString() ?? "Unknown";
                break;
            }
        }
        catch { /* WMI may not be available */ }

        try
        {
            // Two-sample CPU measurement
            var startTime = DateTime.UtcNow;
            var startCpuUsage = Process.GetProcesses().Sum(p =>
            {
                try { return p.TotalProcessorTime.TotalMilliseconds; }
                catch { return 0; }
            });

            await Task.Delay(500);

            var endTime = DateTime.UtcNow;
            var endCpuUsage = Process.GetProcesses().Sum(p =>
            {
                try { return p.TotalProcessorTime.TotalMilliseconds; }
                catch { return 0; }
            });

            var cpuUsedMs = endCpuUsage - startCpuUsage;
            var totalMs = (endTime - startTime).TotalMilliseconds * Environment.ProcessorCount;
            cpuStats.UsagePercent = Math.Round(Math.Min(cpuUsedMs / totalMs * 100, 100), 1);
        }
        catch
        {
            cpuStats.UsagePercent = 0;
        }

        return cpuStats;
    }

    // ── Memory ─────────────────────────────────────────────────

    public MemoryStats GetMemoryInfo()
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(
                "SELECT TotalVisibleMemorySize, FreePhysicalMemory FROM Win32_OperatingSystem");
            foreach (ManagementObject obj in searcher.Get())
            {
                var totalKb = Convert.ToInt64(obj["TotalVisibleMemorySize"]);
                var freeKb = Convert.ToInt64(obj["FreePhysicalMemory"]);
                var totalBytes = totalKb * 1024;
                var freeBytes = freeKb * 1024;
                var usedBytes = totalBytes - freeBytes;

                return new MemoryStats
                {
                    TotalBytes = totalBytes,
                    UsedBytes = usedBytes,
                    AvailableBytes = freeBytes,
                    UsagePercent = Math.Round((double)usedBytes / totalBytes * 100, 1)
                };
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to get memory info: {ex.Message}");
        }

        return new MemoryStats();
    }

    // ── Disk ───────────────────────────────────────────────────

    public DiskStats GetDiskInfo()
    {
        try
        {
            // Return info for the system drive
            var systemDrive = Path.GetPathRoot(Environment.SystemDirectory) ?? "C:\\";
            var drive = new DriveInfo(systemDrive);
            if (drive.IsReady)
            {
                return new DiskStats
                {
                    DriveName = drive.Name,
                    TotalBytes = drive.TotalSize,
                    FreeBytes = drive.AvailableFreeSpace,
                    UsedBytes = drive.TotalSize - drive.AvailableFreeSpace,
                    UsagePercent = Math.Round(
                        (double)(drive.TotalSize - drive.AvailableFreeSpace) / drive.TotalSize * 100, 1)
                };
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to get disk info: {ex.Message}");
        }
        return new DiskStats();
    }

    // ── Network ────────────────────────────────────────────────

    public NetworkStats GetNetworkInfo()
    {
        try
        {
            long totalSent = 0, totalRecv = 0;
            string interfaceName = "";
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up) continue;
                var stats = nic.GetIPStatistics();
                totalSent += stats.BytesSent;
                totalRecv += stats.BytesReceived;
                if (string.IsNullOrEmpty(interfaceName))
                    interfaceName = nic.Name;
            }

            var now = DateTime.UtcNow;
            var elapsed = (now - _prevNetTime).TotalSeconds;
            var sentPerSec = elapsed > 0 ? (long)((totalSent - _prevBytesSent) / elapsed) : 0;
            var recvPerSec = elapsed > 0 ? (long)((totalRecv - _prevBytesRecv) / elapsed) : 0;

            _prevBytesSent = totalSent;
            _prevBytesRecv = totalRecv;
            _prevNetTime = now;

            return new NetworkStats
            {
                InterfaceName = interfaceName,
                BytesSent = totalSent,
                BytesReceived = totalRecv,
                SendSpeed = Math.Max(0, sentPerSec),
                ReceiveSpeed = Math.Max(0, recvPerSec)
            };
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to get network info: {ex.Message}");
            return new NetworkStats();
        }
    }

    // ── Processes ──────────────────────────────────────────────

    public List<ProcessInfo> GetProcessList()
    {
        var result = new List<ProcessInfo>();
        try
        {
            foreach (var p in Process.GetProcesses())
            {
                try
                {
                    result.Add(new ProcessInfo
                    {
                        Pid = p.Id,
                        Name = p.ProcessName,
                        MemoryBytes = p.WorkingSet64,
                        StartTime = p.StartTime.ToUniversalTime()
                    });
                }
                catch { /* access denied for some system processes */ }
                finally { p.Dispose(); }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to get process list: {ex.Message}");
        }
        return result;
    }

    // ── Ports ──────────────────────────────────────────────────

    public List<ActivePort> GetActivePorts()
    {
        var ports = new List<ActivePort>();
        try
        {
            var properties = IPGlobalProperties.GetIPGlobalProperties();

            foreach (var tcp in properties.GetActiveTcpListeners())
            {
                ports.Add(new ActivePort
                {
                    Protocol = "TCP",
                    LocalAddress = tcp.Address.ToString(),
                    LocalPort = tcp.Port,
                    State = "LISTENING"
                });
            }

            foreach (var conn in properties.GetActiveTcpConnections())
            {
                ports.Add(new ActivePort
                {
                    Protocol = "TCP",
                    LocalAddress = conn.LocalEndPoint.Address.ToString(),
                    LocalPort = conn.LocalEndPoint.Port,
                    State = conn.State.ToString()
                });
            }

            foreach (var udp in properties.GetActiveUdpListeners())
            {
                ports.Add(new ActivePort
                {
                    Protocol = "UDP",
                    LocalAddress = udp.Address.ToString(),
                    LocalPort = udp.Port
                });
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to get active ports: {ex.Message}");
        }
        return ports;
    }

    // ── Kill Process ───────────────────────────────────────────

    public (bool Success, string? Error) KillProcess(int pid)
    {
        try
        {
            var process = Process.GetProcessById(pid);
            process.Kill(entireProcessTree: true);
            process.Dispose();
            return (true, null);
        }
        catch (ArgumentException)
        {
            return (false, $"Process {pid} not found.");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    // ── System Info ────────────────────────────────────────────

    public Dictionary<string, string> GetSystemInfo()
    {
        var info = new Dictionary<string, string>
        {
            ["MachineName"] = Environment.MachineName,
            ["OSVersion"] = Environment.OSVersion.ToString(),
            ["ProcessorCount"] = Environment.ProcessorCount.ToString(),
            ["Is64BitOS"] = Environment.Is64BitOperatingSystem.ToString(),
            ["UserName"] = Environment.UserName,
            ["SystemDirectory"] = Environment.SystemDirectory,
            ["CLRVersion"] = Environment.Version.ToString()
        };

        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT Name FROM Win32_Processor");
            foreach (ManagementObject obj in searcher.Get())
            {
                info["Processor"] = obj["Name"]?.ToString() ?? "Unknown";
                break;
            }
        }
        catch { /* WMI may not be available */ }

        return info;
    }

    // ── Periodic Collection ────────────────────────────────────

    private async void CollectStats()
    {
        try
        {
            var cpu = await GetCpuUsageAsync();
            var memory = GetMemoryInfo();
            var disk = GetDiskInfo();
            var network = GetNetworkInfo();

            var stats = new SystemStats
            {
                Cpu = cpu,
                Memory = memory,
                Disk = disk,
                Network = network,
                Timestamp = DateTime.UtcNow
            };

            lock (_lock) { _lastStats = stats; }
            OnStatsUpdated?.Invoke(this, stats);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to collect stats: {ex.Message}");
        }
    }

    public void Dispose()
    {
        _timer?.Dispose();
        _timer = null;
        GC.SuppressFinalize(this);
    }
}
