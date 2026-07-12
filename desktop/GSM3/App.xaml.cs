using Microsoft.UI.Xaml;
using Microsoft.Extensions.DependencyInjection;
using GSM3.Services;

namespace GSM3;

public partial class App : Application
{
    private Window? _window;

    public App()
    {
        InitializeComponent();
        ConfigureServices();
    }

    private void ConfigureServices()
    {
        var services = new ServiceCollection();

        services.AddSingleton<ConfigManager>();
        services.AddSingleton<UserManager>();
        services.AddSingleton<InstanceManager>();
        services.AddSingleton<TerminalManager>();
        services.AddSingleton<SystemMonitor>();
        services.AddSingleton<BackupManager>();
        services.AddSingleton<SchedulerManager>();
        services.AddSingleton<FileManager>();
        services.AddSingleton<RconManager>();
        services.AddSingleton<SteamCMDManager>();

        var provider = services.BuildServiceProvider();
        ServiceLocator.Initialize(provider);
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new MainWindow();
        _window.Activate();
    }

    public static Window? MainAppWindow => (Current as App)?._window;
}
