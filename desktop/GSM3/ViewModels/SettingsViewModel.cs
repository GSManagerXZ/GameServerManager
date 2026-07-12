namespace GSM3.ViewModels;

using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using GSM3.Models;
using GSM3.Services;
using System.Diagnostics;

public partial class SettingsViewModel : ObservableObject
{
    private readonly ConfigManager _configManager;

    [ObservableProperty] private AppConfig config = new();
    [ObservableProperty] private string statusMessage = "";
    [ObservableProperty] private bool isLoading;
    [ObservableProperty] private bool hasUnsavedChanges;

    // Flattened config properties for easier binding
    [ObservableProperty] private int serverPort;
    [ObservableProperty] private string serverHost = "0.0.0.0";
    [ObservableProperty] private int maxLoginAttempts;
    [ObservableProperty] private int lockoutDurationMinutes;
    [ObservableProperty] private int sessionTimeoutMinutes;
    [ObservableProperty] private string steamCmdInstallPath = "";
    [ObservableProperty] private string terminalDefaultUser = "";
    [ObservableProperty] private int terminalMaxSessions;
    [ObservableProperty] private int terminalTimeoutMinutes;
    [ObservableProperty] private string gameDefaultInstallPath = "";

    // Theme
    [ObservableProperty] private int selectedThemeIndex;

    public SettingsViewModel()
    {
        _configManager = ServiceLocator.GetService<ConfigManager>();
    }

    public async Task LoadAsync()
    {
        IsLoading = true;
        try
        {
            await _configManager.InitializeAsync();
            LoadConfigValues();
            StatusMessage = "Settings loaded.";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Failed to load settings: {ex.Message}";
            Debug.WriteLine($"SettingsLoad error: {ex}");
        }
        finally
        {
            IsLoading = false;
        }
    }

    private void LoadConfigValues()
    {
        var cfg = _configManager.GetConfig();
        Config = cfg;

        // Server
        ServerPort = cfg.Server.Port;
        ServerHost = cfg.Server.Host;

        // Auth
        MaxLoginAttempts = cfg.Auth.MaxLoginAttempts;
        LockoutDurationMinutes = cfg.Auth.LockoutDurationMinutes;
        SessionTimeoutMinutes = cfg.Auth.SessionTimeoutMinutes;

        // SteamCMD
        SteamCmdInstallPath = cfg.SteamCMD.InstallPath;

        // Terminal
        TerminalDefaultUser = cfg.Terminal.DefaultUser;
        TerminalMaxSessions = cfg.Terminal.MaxSessions;
        TerminalTimeoutMinutes = cfg.Terminal.TimeoutMinutes;

        // Game
        GameDefaultInstallPath = cfg.Game.DefaultInstallPath;

        HasUnsavedChanges = false;
    }

    [RelayCommand]
    private async Task SaveSettingsAsync()
    {
        IsLoading = true;
        try
        {
            await _configManager.UpdateConfigAsync(cfg =>
            {
                // Server
                cfg.Server.Port = ServerPort;
                cfg.Server.Host = ServerHost;

                // Auth
                cfg.Auth.MaxLoginAttempts = MaxLoginAttempts;
                cfg.Auth.LockoutDurationMinutes = LockoutDurationMinutes;
                cfg.Auth.SessionTimeoutMinutes = SessionTimeoutMinutes;

                // SteamCMD
                cfg.SteamCMD.InstallPath = SteamCmdInstallPath;

                // Terminal
                cfg.Terminal.DefaultUser = TerminalDefaultUser;
                cfg.Terminal.MaxSessions = TerminalMaxSessions;
                cfg.Terminal.TimeoutMinutes = TerminalTimeoutMinutes;

                // Game
                cfg.Game.DefaultInstallPath = GameDefaultInstallPath;
            });

            HasUnsavedChanges = false;
            StatusMessage = "Settings saved.";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Failed to save settings: {ex.Message}";
            Debug.WriteLine($"SaveSettings error: {ex}");
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private async Task ResetSettingsAsync()
    {
        IsLoading = true;
        try
        {
            // Reset to defaults by creating a new AppConfig
            await _configManager.UpdateConfigAsync(cfg =>
            {
                var defaults = new AppConfig();

                cfg.Server.Port = defaults.Server.Port;
                cfg.Server.Host = defaults.Server.Host;

                cfg.Auth.MaxLoginAttempts = defaults.Auth.MaxLoginAttempts;
                cfg.Auth.LockoutDurationMinutes = defaults.Auth.LockoutDurationMinutes;
                cfg.Auth.SessionTimeoutMinutes = defaults.Auth.SessionTimeoutMinutes;

                cfg.SteamCMD.InstallPath = defaults.SteamCMD.InstallPath;

                cfg.Terminal.DefaultUser = defaults.Terminal.DefaultUser;
                cfg.Terminal.MaxSessions = defaults.Terminal.MaxSessions;
                cfg.Terminal.TimeoutMinutes = defaults.Terminal.TimeoutMinutes;

                cfg.Game.DefaultInstallPath = defaults.Game.DefaultInstallPath;
            });

            LoadConfigValues();
            StatusMessage = "Settings reset to defaults.";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Failed to reset settings: {ex.Message}";
            Debug.WriteLine($"ResetSettings error: {ex}");
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private void BrowseSteamCMDPath()
    {
        // In WinUI 3, folder picking must be initiated from the View layer
        // (using Windows.Storage.Pickers.FolderPicker) and the result passed here.
        // This command signals intent; the View handles the picker and calls SetSteamCMDPath.
        StatusMessage = "Use the browse button to select a SteamCMD folder.";
    }

    [RelayCommand]
    private void BrowseGamePath()
    {
        // Same pattern as SteamCMD path - the View handles the picker dialog.
        StatusMessage = "Use the browse button to select a game install folder.";
    }

    /// <summary>
    /// Called from the View after a FolderPicker dialog completes for SteamCMD path.
    /// </summary>
    public void SetSteamCMDPath(string path)
    {
        SteamCmdInstallPath = path;
        HasUnsavedChanges = true;
    }

    /// <summary>
    /// Called from the View after a FolderPicker dialog completes for game install path.
    /// </summary>
    public void SetGamePath(string path)
    {
        GameDefaultInstallPath = path;
        HasUnsavedChanges = true;
    }

    // Track changes on any property update
    partial void OnServerPortChanged(int value) => HasUnsavedChanges = true;
    partial void OnServerHostChanged(string value) => HasUnsavedChanges = true;
    partial void OnMaxLoginAttemptsChanged(int value) => HasUnsavedChanges = true;
    partial void OnLockoutDurationMinutesChanged(int value) => HasUnsavedChanges = true;
    partial void OnSessionTimeoutMinutesChanged(int value) => HasUnsavedChanges = true;
    partial void OnSteamCmdInstallPathChanged(string value) => HasUnsavedChanges = true;
    partial void OnTerminalDefaultUserChanged(string value) => HasUnsavedChanges = true;
    partial void OnTerminalMaxSessionsChanged(int value) => HasUnsavedChanges = true;
    partial void OnTerminalTimeoutMinutesChanged(int value) => HasUnsavedChanges = true;
    partial void OnGameDefaultInstallPathChanged(string value) => HasUnsavedChanges = true;
    partial void OnSelectedThemeIndexChanged(int value) => HasUnsavedChanges = true;
}
