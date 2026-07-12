using System.Collections.ObjectModel;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace GSM3.Pages;

public sealed partial class SystemPage : Page
{
    public SystemPage()
    {
        InitializeComponent();
        Loaded += SystemPage_Loaded;
    }

    private void SystemPage_Loaded(object sender, RoutedEventArgs e)
    {
        LoadSampleData();
    }

    private void LoadSampleData()
    {
        // CPU
        CpuBar.Value = 35;
        CpuText.Text = "35%";

        // Memory
        MemoryBar.Value = 68;
        MemoryText.Text = "68%";
        MemoryDetailText.Text = "10.9 GB / 16.0 GB";

        // Disk
        DiskBar.Value = 45;
        DiskText.Text = "45%";

        // Network
        UploadText.Text = "1.2 MB/s";
        DownloadText.Text = "5.8 MB/s";

        // Process list sample data
        var processes = new ObservableCollection<ProcessDisplayItem>
        {
            new() { Pid = 1024, Name = "java.exe", CpuPercent = 12.5, MemoryDisplay = "1.2 GB" },
            new() { Pid = 2048, Name = "steamcmd.exe", CpuPercent = 5.3, MemoryDisplay = "512 MB" },
            new() { Pid = 3072, Name = "minecraft_server", CpuPercent = 8.7, MemoryDisplay = "2.4 GB" },
            new() { Pid = 4096, Name = "nginx.exe", CpuPercent = 0.8, MemoryDisplay = "64 MB" },
            new() { Pid = 5120, Name = "node.exe", CpuPercent = 3.2, MemoryDisplay = "256 MB" },
        };
        ProcessListView.ItemsSource = processes;

        // Active ports sample data
        var ports = new ObservableCollection<PortDisplayItem>
        {
            new() { Protocol = "TCP", LocalAddress = "0.0.0.0", LocalPort = 25565, RemoteAddress = "*", State = "LISTEN", ProcessName = "java.exe" },
            new() { Protocol = "TCP", LocalAddress = "0.0.0.0", LocalPort = 80, RemoteAddress = "*", State = "LISTEN", ProcessName = "nginx.exe" },
            new() { Protocol = "TCP", LocalAddress = "192.168.1.10", LocalPort = 25565, RemoteAddress = "192.168.1.50", State = "ESTABLISHED", ProcessName = "java.exe" },
            new() { Protocol = "UDP", LocalAddress = "0.0.0.0", LocalPort = 27015, RemoteAddress = "*", State = "LISTEN", ProcessName = "srcds.exe" },
            new() { Protocol = "TCP", LocalAddress = "0.0.0.0", LocalPort = 3000, RemoteAddress = "*", State = "LISTEN", ProcessName = "node.exe" },
        };
        PortListView.ItemsSource = ports;
    }

    private void RefreshButton_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Refresh system monitoring data
        LoadSampleData();
    }

    private void KillProcessButton_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Kill selected process
    }
}

/// <summary>
/// Display item for the process list view.
/// </summary>
public class ProcessDisplayItem
{
    public int Pid { get; set; }
    public string Name { get; set; } = "";
    public double CpuPercent { get; set; }
    public string MemoryDisplay { get; set; } = "";
}

/// <summary>
/// Display item for the port list view.
/// </summary>
public class PortDisplayItem
{
    public string Protocol { get; set; } = "";
    public string LocalAddress { get; set; } = "";
    public int LocalPort { get; set; }
    public string RemoteAddress { get; set; } = "";
    public string State { get; set; } = "";
    public string ProcessName { get; set; } = "";
}
