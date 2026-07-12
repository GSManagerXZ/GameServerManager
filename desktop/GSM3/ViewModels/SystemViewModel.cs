namespace GSM3.ViewModels;

using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using GSM3.Models;
using GSM3.Services;
using System.Collections.ObjectModel;
using System.Diagnostics;

public partial class SystemViewModel : ObservableObject, IDisposable
{
    private readonly SystemMonitor _systemMonitor;
    private Timer? _refreshTimer;

    [ObservableProperty] private double cpuUsage;
    [ObservableProperty] private double memoryUsage;
    [ObservableProperty] private long totalMemory;
    [ObservableProperty] private long usedMemory;
    [ObservableProperty] private long availableMemory;
    [ObservableProperty] private double diskUsage;
    [ObservableProperty] private long diskTotal;
    [ObservableProperty] private long diskFree;
    [ObservableProperty] private string cpuModel = "";
    [ObservableProperty] private int cpuCores;
    [ObservableProperty] private long networkBytesSent;
    [ObservableProperty] private long networkBytesReceived;
    [ObservableProperty] private long networkSendSpeed;
    [ObservableProperty] private long networkReceiveSpeed;
    [ObservableProperty] private string machineName = "";
    [ObservableProperty] private string osVersion = "";
    [ObservableProperty] private bool isMonitoring;
    [ObservableProperty] private int refreshIntervalSeconds = 5;
    [ObservableProperty] private string statusMessage = "";
    [ObservableProperty] private bool isLoading;

    public ObservableCollection<ProcessInfo> Processes { get; } = new();
    public ObservableCollection<ActivePort> Ports { get; } = new();

    public SystemViewModel()
    {
        _systemMonitor = ServiceLocator.GetService<SystemMonitor>();
    }

    public async Task LoadAsync()
    {
        IsLoading = true;
        try
        {
            LoadSystemInfo();
            await RefreshAsync();
        }
        finally
        {
            IsLoading = false;
        }
    }

    private void LoadSystemInfo()
    {
        var info = _systemMonitor.GetSystemInfo();

        if (info.TryGetValue("MachineName", out var machine))
            MachineName = machine;
        if (info.TryGetValue("OSVersion", out var os))
            OsVersion = os;
        if (info.TryGetValue("Processor", out var proc))
            CpuModel = proc;
        if (info.TryGetValue("ProcessorCount", out var cores) && int.TryParse(cores, out var coreCount))
            CpuCores = coreCount;
    }

    [RelayCommand]
    private async Task RefreshAsync()
    {
        IsLoading = true;
        try
        {
            // CPU usage
            var cpu = await _systemMonitor.GetCpuUsageAsync();
            CpuUsage = cpu.UsagePercent;

            // Memory
            var memory = _systemMonitor.GetMemoryInfo();
            MemoryUsage = memory.UsagePercent;
            TotalMemory = memory.TotalBytes;
            UsedMemory = memory.UsedBytes;
            AvailableMemory = memory.AvailableBytes;

            // Disk
            var disk = _systemMonitor.GetDiskInfo();
            DiskUsage = disk.UsagePercent;
            DiskTotal = disk.TotalBytes;
            DiskFree = disk.FreeBytes;

            // Network
            var network = _systemMonitor.GetNetworkInfo();
            NetworkBytesSent = network.BytesSent;
            NetworkBytesReceived = network.BytesReceived;
            NetworkSendSpeed = network.SendSpeed;
            NetworkReceiveSpeed = network.ReceiveSpeed;

            // Processes
            RefreshProcesses();

            // Ports
            RefreshPorts();

            StatusMessage = $"Refreshed at {DateTime.Now:HH:mm:ss}";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Refresh failed: {ex.Message}";
            Debug.WriteLine($"SystemRefresh error: {ex}");
        }
        finally
        {
            IsLoading = false;
        }
    }

    private void RefreshProcesses()
    {
        var processes = _systemMonitor.GetProcessList();
        Processes.Clear();

        // Sort by memory usage descending, take top 100
        foreach (var proc in processes.OrderByDescending(p => p.MemoryBytes).Take(100))
            Processes.Add(proc);
    }

    private void RefreshPorts()
    {
        var ports = _systemMonitor.GetActivePorts();
        Ports.Clear();

        foreach (var port in ports.OrderBy(p => p.LocalPort))
            Ports.Add(port);
    }

    [RelayCommand]
    private void KillProcess(int pid)
    {
        var result = _systemMonitor.KillProcess(pid);
        if (result.Success)
        {
            var killed = Processes.FirstOrDefault(p => p.Pid == pid);
            if (killed != null)
                Processes.Remove(killed);
            StatusMessage = $"Process {pid} terminated.";
        }
        else
        {
            StatusMessage = $"Failed to kill process {pid}: {result.Error}";
        }
    }

    partial void OnIsMonitoringChanged(bool value)
    {
        if (value)
        {
            StartMonitoring();
        }
        else
        {
            StopMonitoring();
        }
    }

    partial void OnRefreshIntervalSecondsChanged(int value)
    {
        // Restart monitoring with new interval if currently active
        if (IsMonitoring)
        {
            StopMonitoring();
            StartMonitoring();
        }
    }

    private void StartMonitoring()
    {
        _refreshTimer?.Dispose();

        var intervalMs = Math.Max(1000, RefreshIntervalSeconds * 1000);
        _refreshTimer = new Timer(async _ =>
        {
            try
            {
                await RefreshAsync();
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Auto-refresh error: {ex.Message}");
            }
        }, null, 0, intervalMs);

        StatusMessage = $"Monitoring started (every {RefreshIntervalSeconds}s).";
    }

    private void StopMonitoring()
    {
        _refreshTimer?.Dispose();
        _refreshTimer = null;
        StatusMessage = "Monitoring stopped.";
    }

    public void Dispose()
    {
        _refreshTimer?.Dispose();
        _refreshTimer = null;
        GC.SuppressFinalize(this);
    }
}
