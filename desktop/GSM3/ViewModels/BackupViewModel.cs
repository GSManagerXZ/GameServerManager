namespace GSM3.ViewModels;

using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using GSM3.Models;
using GSM3.Services;
using System.Collections.ObjectModel;
using System.Diagnostics;

public partial class BackupViewModel : ObservableObject
{
    private readonly BackupManager _backupManager;
    private readonly InstanceManager _instanceManager;

    public ObservableCollection<BackupInfo> Backups { get; } = new();
    public ObservableCollection<Instance> Instances { get; } = new();

    [ObservableProperty] private Instance? selectedInstance;
    [ObservableProperty] private BackupInfo? selectedBackup;
    [ObservableProperty] private string statusMessage = "";
    [ObservableProperty] private bool isLoading;
    [ObservableProperty] private string backupNotes = "";

    public BackupViewModel()
    {
        _backupManager = ServiceLocator.GetService<BackupManager>();
        _instanceManager = ServiceLocator.GetService<InstanceManager>();
    }

    public async Task LoadAsync()
    {
        IsLoading = true;
        try
        {
            await _backupManager.InitializeAsync();
            await _instanceManager.InitializeAsync();

            // Load instance list for filtering
            var instances = _instanceManager.GetInstances();
            Instances.Clear();
            foreach (var inst in instances)
                Instances.Add(inst);

            await RefreshAsync();
        }
        finally
        {
            IsLoading = false;
        }
    }

    partial void OnSelectedInstanceChanged(Instance? value)
    {
        // Re-filter backups when instance selection changes
        _ = RefreshAsync();
    }

    [RelayCommand]
    private async Task RefreshAsync()
    {
        IsLoading = true;
        try
        {
            var backups = _backupManager.ListBackups(SelectedInstance?.Id);
            Backups.Clear();
            foreach (var backup in backups)
                Backups.Add(backup);

            StatusMessage = $"{Backups.Count} backup(s) found.";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Failed to load backups: {ex.Message}";
            Debug.WriteLine($"BackupRefresh error: {ex}");
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private async Task CreateBackupAsync()
    {
        if (SelectedInstance == null)
        {
            StatusMessage = "Please select an instance to back up.";
            return;
        }

        IsLoading = true;
        StatusMessage = $"Creating backup for '{SelectedInstance.Name}'...";
        try
        {
            var notes = string.IsNullOrWhiteSpace(BackupNotes) ? null : BackupNotes.Trim();
            var result = await _backupManager.CreateBackupAsync(SelectedInstance.Id, notes);

            if (result.Success && result.Backup != null)
            {
                BackupNotes = "";
                await RefreshAsync();
                StatusMessage = $"Backup created: {result.Backup.FileName}";
            }
            else
            {
                StatusMessage = $"Backup failed: {result.Error}";
            }
        }
        catch (Exception ex)
        {
            StatusMessage = $"Backup failed: {ex.Message}";
            Debug.WriteLine($"CreateBackup error: {ex}");
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private async Task RestoreBackupAsync()
    {
        if (SelectedBackup == null)
        {
            StatusMessage = "No backup selected.";
            return;
        }

        IsLoading = true;
        StatusMessage = $"Restoring backup '{SelectedBackup.FileName}'...";
        try
        {
            var result = await _backupManager.RestoreBackupAsync(SelectedBackup.Id);

            if (result.Success)
            {
                StatusMessage = $"Backup '{SelectedBackup.FileName}' restored successfully.";
            }
            else
            {
                StatusMessage = $"Restore failed: {result.Error}";
            }
        }
        catch (Exception ex)
        {
            StatusMessage = $"Restore failed: {ex.Message}";
            Debug.WriteLine($"RestoreBackup error: {ex}");
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private async Task DeleteBackupAsync()
    {
        if (SelectedBackup == null)
        {
            StatusMessage = "No backup selected.";
            return;
        }

        IsLoading = true;
        try
        {
            var fileName = SelectedBackup.FileName;
            var result = await _backupManager.DeleteBackupAsync(SelectedBackup.Id);

            if (result.Success)
            {
                SelectedBackup = null;
                await RefreshAsync();
                StatusMessage = $"Backup '{fileName}' deleted.";
            }
            else
            {
                StatusMessage = $"Delete failed: {result.Error}";
            }
        }
        catch (Exception ex)
        {
            StatusMessage = $"Delete failed: {ex.Message}";
            Debug.WriteLine($"DeleteBackup error: {ex}");
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private void ClearFilter()
    {
        SelectedInstance = null;
        // OnSelectedInstanceChanged will trigger refresh
    }

    public string FormatFileSize(long bytes)
    {
        if (bytes < 1024) return $"{bytes} B";
        if (bytes < 1024 * 1024) return $"{bytes / 1024.0:F1} KB";
        if (bytes < 1024 * 1024 * 1024) return $"{bytes / (1024.0 * 1024):F1} MB";
        return $"{bytes / (1024.0 * 1024 * 1024):F2} GB";
    }
}
