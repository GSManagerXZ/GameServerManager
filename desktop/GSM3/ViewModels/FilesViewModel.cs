namespace GSM3.ViewModels;

using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using GSM3.Models;
using GSM3.Services;
using System.Collections.ObjectModel;
using System.Diagnostics;

public partial class FilesViewModel : ObservableObject
{
    private readonly FileManager _fileManager;
    private readonly Stack<string> _navigationHistory = new();

    public ObservableCollection<FileItem> Files { get; } = new();
    public ObservableCollection<string> PathSegments { get; } = new();
    public ObservableCollection<DriveEntry> DriveList { get; } = new();
    public ObservableCollection<FileItem> SelectedItems { get; } = new();

    [ObservableProperty] private string currentPath = "";
    [ObservableProperty] private string statusMessage = "";
    [ObservableProperty] private bool isLoading;
    [ObservableProperty] private string newFileName = "";
    [ObservableProperty] private string newFolderName = "";
    [ObservableProperty] private string searchPattern = "";
    [ObservableProperty] private int fileCount;
    [ObservableProperty] private int folderCount;

    public FilesViewModel()
    {
        _fileManager = ServiceLocator.GetService<FileManager>();
    }

    public void Load()
    {
        LoadDrives();
        // Start at the first available drive
        if (DriveList.Count > 0)
        {
            var readyDrive = DriveList.FirstOrDefault(d => d.IsReady);
            if (readyDrive != null)
                NavigateTo(readyDrive.Name);
        }
    }

    private void LoadDrives()
    {
        DriveList.Clear();
        var drives = _fileManager.GetDrives();
        foreach (var drive in drives)
            DriveList.Add(drive);
    }

    [RelayCommand]
    private void NavigateTo(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;

        IsLoading = true;
        try
        {
            // Push current path to history before navigating
            if (!string.IsNullOrEmpty(CurrentPath))
                _navigationHistory.Push(CurrentPath);

            CurrentPath = path;
            RefreshFiles();
            UpdatePathSegments();
            StatusMessage = $"{FileCount} file(s), {FolderCount} folder(s)";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Navigation failed: {ex.Message}";
            Debug.WriteLine($"NavigateTo error: {ex}");
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private void GoUp()
    {
        if (string.IsNullOrEmpty(CurrentPath)) return;

        var parent = Path.GetDirectoryName(CurrentPath);
        if (!string.IsNullOrEmpty(parent))
        {
            NavigateTo(parent);
        }
        else
        {
            // At root of a drive, stay put
            StatusMessage = "Already at root.";
        }
    }

    [RelayCommand]
    private void GoBack()
    {
        if (_navigationHistory.Count == 0)
        {
            StatusMessage = "No navigation history.";
            return;
        }

        var previousPath = _navigationHistory.Pop();
        CurrentPath = previousPath;

        IsLoading = true;
        try
        {
            RefreshFiles();
            UpdatePathSegments();
            StatusMessage = $"{FileCount} file(s), {FolderCount} folder(s)";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Navigation failed: {ex.Message}";
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private void Refresh()
    {
        if (string.IsNullOrEmpty(CurrentPath)) return;

        IsLoading = true;
        try
        {
            RefreshFiles();
            StatusMessage = $"{FileCount} file(s), {FolderCount} folder(s)";
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private void CreateFile()
    {
        if (string.IsNullOrEmpty(CurrentPath) || string.IsNullOrWhiteSpace(NewFileName))
        {
            StatusMessage = "Please enter a file name.";
            return;
        }

        var filePath = Path.Combine(CurrentPath, NewFileName.Trim());
        var result = _fileManager.CreateFile(filePath);

        if (result.Success)
        {
            NewFileName = "";
            RefreshFiles();
            StatusMessage = $"File '{Path.GetFileName(filePath)}' created.";
        }
        else
        {
            StatusMessage = $"Failed to create file: {result.Error}";
        }
    }

    [RelayCommand]
    private void CreateFolder()
    {
        if (string.IsNullOrEmpty(CurrentPath) || string.IsNullOrWhiteSpace(NewFolderName))
        {
            StatusMessage = "Please enter a folder name.";
            return;
        }

        var folderPath = Path.Combine(CurrentPath, NewFolderName.Trim());
        var result = _fileManager.CreateDirectory(folderPath);

        if (result.Success)
        {
            NewFolderName = "";
            RefreshFiles();
            StatusMessage = $"Folder '{Path.GetFileName(folderPath)}' created.";
        }
        else
        {
            StatusMessage = $"Failed to create folder: {result.Error}";
        }
    }

    [RelayCommand]
    private void DeleteSelected()
    {
        if (SelectedItems.Count == 0)
        {
            StatusMessage = "No items selected.";
            return;
        }

        int deleted = 0;
        int failed = 0;

        foreach (var item in SelectedItems.ToList())
        {
            var result = _fileManager.DeleteFile(item.Path);
            if (result.Success)
                deleted++;
            else
                failed++;
        }

        SelectedItems.Clear();
        RefreshFiles();

        if (failed == 0)
            StatusMessage = $"{deleted} item(s) deleted.";
        else
            StatusMessage = $"{deleted} deleted, {failed} failed.";
    }

    [RelayCommand]
    private void SearchFiles()
    {
        if (string.IsNullOrEmpty(CurrentPath) || string.IsNullOrWhiteSpace(SearchPattern))
        {
            StatusMessage = "Enter a search pattern (e.g., *.txt).";
            return;
        }

        IsLoading = true;
        try
        {
            var results = _fileManager.SearchFiles(CurrentPath, SearchPattern.Trim());

            Files.Clear();
            foreach (var entry in results)
            {
                Files.Add(entry);
            }

            FileCount = Files.Count(f => f.Type == FileItemType.File);
            FolderCount = Files.Count(f => f.Type == FileItemType.Directory);
            StatusMessage = $"Search found {Files.Count} result(s).";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Search failed: {ex.Message}";
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private void NavigateToDrive(DriveEntry drive)
    {
        if (drive.IsReady)
            NavigateTo(drive.Name);
        else
            StatusMessage = $"Drive {drive.Name} is not ready.";
    }

    public void OpenItem(FileItem item)
    {
        if (item.Type == FileItemType.Directory)
        {
            NavigateTo(item.Path);
        }
    }

    private void RefreshFiles()
    {
        Files.Clear();
        SelectedItems.Clear();

        var entries = _fileManager.ListDirectory(CurrentPath);

        // Directories first, then files, each sorted by name
        var sorted = entries
            .OrderByDescending(e => e.Type == FileItemType.Directory)
            .ThenBy(e => e.Name, StringComparer.OrdinalIgnoreCase);

        foreach (var entry in sorted)
        {
            Files.Add(entry);
        }

        FileCount = Files.Count(f => f.Type == FileItemType.File);
        FolderCount = Files.Count(f => f.Type == FileItemType.Directory);
    }

    private void UpdatePathSegments()
    {
        PathSegments.Clear();
        if (string.IsNullOrEmpty(CurrentPath)) return;

        // Build breadcrumb segments
        var parts = CurrentPath.Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries);
        var accumulated = "";

        foreach (var part in parts)
        {
            if (string.IsNullOrEmpty(accumulated))
                accumulated = part + Path.DirectorySeparatorChar;
            else
                accumulated = Path.Combine(accumulated, part);

            PathSegments.Add(accumulated);
        }
    }
}
