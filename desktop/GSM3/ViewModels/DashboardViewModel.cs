namespace GSM3.ViewModels;

using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using GSM3.Models;
using GSM3.Services;
using System.Collections.ObjectModel;

public partial class DashboardViewModel : ObservableObject
{
    private readonly InstanceManager _instanceManager;
    private readonly SystemMonitor _systemMonitor;

    [ObservableProperty] private int totalInstances;
    [ObservableProperty] private int runningInstances;
    [ObservableProperty] private int stoppedInstances;
    [ObservableProperty] private double cpuUsage;
    [ObservableProperty] private double memoryUsage;
    [ObservableProperty] private double diskUsage;
    [ObservableProperty] private string cpuModel = "";
    [ObservableProperty] private long totalMemory;
    [ObservableProperty] private long usedMemory;

    public ObservableCollection<Instance> RecentInstances { get; } = new();

    public DashboardViewModel()
    {
        _instanceManager = ServiceLocator.GetService<InstanceManager>();
        _systemMonitor = ServiceLocator.GetService<SystemMonitor>();
    }

    public async Task LoadAsync()
    {
        await _instanceManager.InitializeAsync();
        var instances = _instanceManager.GetInstances();
        TotalInstances = instances.Count;
        RunningInstances = instances.Count(i => i.Status == InstanceStatus.Running);
        StoppedInstances = instances.Count(i => i.Status == InstanceStatus.Stopped);

        RecentInstances.Clear();
        foreach (var inst in instances.Take(5))
            RecentInstances.Add(inst);

        await RefreshSystemStatsAsync();
    }

    [RelayCommand]
    private async Task RefreshSystemStatsAsync()
    {
        // Gather CPU usage asynchronously
        var cpu = await _systemMonitor.GetCpuUsageAsync();
        CpuUsage = cpu.UsagePercent;

        // Memory info
        var memory = _systemMonitor.GetMemoryInfo();
        MemoryUsage = memory.UsagePercent;
        TotalMemory = memory.TotalBytes;
        UsedMemory = memory.UsedBytes;

        // Disk info - primary drive
        var disk = _systemMonitor.GetDiskInfo();
        DiskUsage = disk.UsagePercent;

        // CPU model from system info
        var sysInfo = _systemMonitor.GetSystemInfo();
        if (sysInfo.TryGetValue("Processor", out var processor))
            CpuModel = processor;
    }

    [RelayCommand]
    private async Task RefreshInstancesAsync()
    {
        var instances = _instanceManager.GetInstances();
        TotalInstances = instances.Count;
        RunningInstances = instances.Count(i => i.Status == InstanceStatus.Running);
        StoppedInstances = instances.Count(i => i.Status == InstanceStatus.Stopped);

        RecentInstances.Clear();
        foreach (var inst in instances.Take(5))
            RecentInstances.Add(inst);

        await Task.CompletedTask;
    }
}
