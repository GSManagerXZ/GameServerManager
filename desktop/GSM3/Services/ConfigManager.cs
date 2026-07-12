namespace GSM3.Services;

using System.Text.Json;
using GSM3.Models;

public class ConfigManager
{
    private static readonly string DataDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GSM3");
    private static readonly string ConfigPath = Path.Combine(DataDir, "config.json");

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly object _lock = new();
    private AppConfig _config = new();
    private bool _initialized;

    public AppConfig Config
    {
        get { lock (_lock) { return _config; } }
    }

    public async Task InitializeAsync()
    {
        if (_initialized) return;

        Directory.CreateDirectory(DataDir);

        if (File.Exists(ConfigPath))
        {
            await LoadConfigAsync();
        }
        else
        {
            await SaveConfigAsync();
        }

        _initialized = true;
    }

    public async Task LoadConfigAsync()
    {
        try
        {
            var json = await File.ReadAllTextAsync(ConfigPath);
            var config = JsonSerializer.Deserialize<AppConfig>(json, JsonOptions);
            if (config != null)
            {
                lock (_lock)
                {
                    _config = config;
                }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Failed to load config: {ex.Message}");
            _config = new AppConfig();
        }
    }

    public async Task SaveConfigAsync()
    {
        try
        {
            Directory.CreateDirectory(DataDir);
            string json;
            lock (_lock)
            {
                json = JsonSerializer.Serialize(_config, JsonOptions);
            }
            await File.WriteAllTextAsync(ConfigPath, json);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Failed to save config: {ex.Message}");
        }
    }

    public AppConfig GetConfig()
    {
        lock (_lock)
        {
            return _config;
        }
    }

    public async Task UpdateConfigAsync(Action<AppConfig> updater)
    {
        lock (_lock)
        {
            updater(_config);
        }
        await SaveConfigAsync();
    }
}
