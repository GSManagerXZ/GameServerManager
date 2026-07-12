namespace GSM3.Services;

using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json;
using GSM3.Models;

public class BackupManager
{
    private static readonly string DataDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GSM3");
    private static readonly string BackupsDir = Path.Combine(DataDir, "backups");
    private static readonly string IndexPath = Path.Combine(BackupsDir, "index.json");

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly InstanceManager _instanceManager;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private List<BackupInfo> _backups = new();

    public int MaxBackupsPerInstance { get; set; } = 5;

    public BackupManager(InstanceManager instanceManager)
    {
        _instanceManager = instanceManager;
    }

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(BackupsDir);

        if (File.Exists(IndexPath))
        {
            try
            {
                var json = await File.ReadAllTextAsync(IndexPath);
                _backups = JsonSerializer.Deserialize<List<BackupInfo>>(json, JsonOptions) ?? new();
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Failed to load backup index: {ex.Message}");
                _backups = new();
            }
        }
    }

    public async Task<(bool Success, string? Error, BackupInfo? Backup)> CreateBackupAsync(
        string instanceId, string? notes = null)
    {
        var instance = _instanceManager.GetInstance(instanceId);
        if (instance == null)
            return (false, "Instance not found.", null);

        var sourceDir = instance.WorkingDirectory;
        if (string.IsNullOrEmpty(sourceDir) || !Directory.Exists(sourceDir))
            return (false, "Instance working directory does not exist.", null);

        await _lock.WaitAsync();
        try
        {
            var timestamp = DateTime.UtcNow.ToString("yyyyMMdd_HHmmss");
            var safeName = SanitizeFileName(instance.Name);
            var fileName = $"{safeName}_{timestamp}.zip";
            var instanceBackupDir = Path.Combine(BackupsDir, instanceId);
            Directory.CreateDirectory(instanceBackupDir);
            var filePath = Path.Combine(instanceBackupDir, fileName);

            ZipFile.CreateFromDirectory(sourceDir, filePath, CompressionLevel.Optimal, false);

            var fileInfo = new FileInfo(filePath);
            var backup = new BackupInfo
            {
                InstanceId = instanceId,
                InstanceName = instance.Name,
                FileName = fileName,
                FilePath = filePath,
                FileSize = fileInfo.Length,
                CreatedAt = DateTime.UtcNow
            };

            _backups.Add(backup);

            // Enforce retention policy
            EnforceRetention(instanceId);

            await SaveIndexAsync();
            return (true, null, backup);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to create backup: {ex.Message}");
            return (false, $"Backup failed: {ex.Message}", null);
        }
        finally
        {
            _lock.Release();
        }
    }

    public Task<(bool Success, string? Error)> RestoreBackupAsync(string backupId, string? targetPath = null)
    {
        var backup = _backups.FirstOrDefault(b => b.Id == backupId);
        if (backup == null)
            return Task.FromResult<(bool, string?)>((false, "Backup not found."));

        if (!File.Exists(backup.FilePath))
            return Task.FromResult<(bool, string?)>((false, "Backup file is missing."));

        var destination = targetPath;
        if (string.IsNullOrEmpty(destination))
        {
            var instance = _instanceManager.GetInstance(backup.InstanceId);
            if (instance == null)
                return Task.FromResult<(bool, string?)>((false, "Instance not found and no target path specified."));
            destination = instance.WorkingDirectory;
        }

        try
        {
            if (Directory.Exists(destination))
            {
                Directory.Delete(destination, recursive: true);
            }
            Directory.CreateDirectory(destination);
            ZipFile.ExtractToDirectory(backup.FilePath, destination, overwriteFiles: true);
            return Task.FromResult<(bool, string?)>((true, null));
        }
        catch (Exception ex)
        {
            return Task.FromResult<(bool, string?)>((false, $"Restore failed: {ex.Message}"));
        }
    }

    public List<BackupInfo> ListBackups(string? instanceId = null)
    {
        if (instanceId != null)
            return _backups.Where(b => b.InstanceId == instanceId)
                           .OrderByDescending(b => b.CreatedAt)
                           .ToList();

        return _backups.OrderByDescending(b => b.CreatedAt).ToList();
    }

    public async Task<(bool Success, string? Error)> DeleteBackupAsync(string backupId)
    {
        await _lock.WaitAsync();
        try
        {
            var backup = _backups.FirstOrDefault(b => b.Id == backupId);
            if (backup == null)
                return (false, "Backup not found.");

            if (File.Exists(backup.FilePath))
            {
                File.Delete(backup.FilePath);
            }

            _backups.Remove(backup);
            await SaveIndexAsync();
            return (true, null);
        }
        finally
        {
            _lock.Release();
        }
    }

    // ── Retention Policy ───────────────────────────────────────

    private void EnforceRetention(string instanceId)
    {
        if (MaxBackupsPerInstance <= 0) return;

        var instanceBackups = _backups
            .Where(b => b.InstanceId == instanceId)
            .OrderByDescending(b => b.CreatedAt)
            .ToList();

        while (instanceBackups.Count > MaxBackupsPerInstance)
        {
            var oldest = instanceBackups.Last();
            if (File.Exists(oldest.FilePath))
            {
                File.Delete(oldest.FilePath);
            }
            _backups.Remove(oldest);
            instanceBackups.Remove(oldest);
        }
    }

    // ── Helpers ────────────────────────────────────────────────

    private async Task SaveIndexAsync()
    {
        try
        {
            var json = JsonSerializer.Serialize(_backups, JsonOptions);
            await File.WriteAllTextAsync(IndexPath, json);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to save backup index: {ex.Message}");
        }
    }

    private static string SanitizeFileName(string name)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var sb = new System.Text.StringBuilder(name.Length);
        foreach (var c in name)
        {
            sb.Append(Array.IndexOf(invalid, c) >= 0 ? '_' : c);
        }
        return sb.ToString();
    }
}
