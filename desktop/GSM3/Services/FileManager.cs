namespace GSM3.Services;

using System.Diagnostics;
using GSM3.Models;

public class FileManager
{
    public List<FileItem> ListDirectory(string path)
    {
        var entries = new List<FileItem>();

        if (!Directory.Exists(path))
            return entries;

        try
        {
            var dirInfo = new DirectoryInfo(path);

            foreach (var dir in dirInfo.GetDirectories())
            {
                try
                {
                    entries.Add(new FileItem
                    {
                        Name = dir.Name,
                        Path = dir.FullName,
                        Type = FileItemType.Directory,
                        CreatedAt = dir.CreationTimeUtc,
                        ModifiedAt = dir.LastWriteTimeUtc,
                        IsReadOnly = dir.Attributes.HasFlag(FileAttributes.ReadOnly),
                        IsHidden = dir.Attributes.HasFlag(FileAttributes.Hidden)
                    });
                }
                catch { /* skip inaccessible dirs */ }
            }

            foreach (var file in dirInfo.GetFiles())
            {
                try
                {
                    entries.Add(new FileItem
                    {
                        Name = file.Name,
                        Path = file.FullName,
                        Type = FileItemType.File,
                        Size = file.Length,
                        CreatedAt = file.CreationTimeUtc,
                        ModifiedAt = file.LastWriteTimeUtc,
                        Extension = file.Extension,
                        IsReadOnly = file.IsReadOnly,
                        IsHidden = file.Attributes.HasFlag(FileAttributes.Hidden)
                    });
                }
                catch { /* skip inaccessible files */ }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to list directory {path}: {ex.Message}");
        }

        return entries;
    }

    public async Task<(bool Success, string? Content, string? Error)> ReadFileAsync(string path)
    {
        try
        {
            if (!File.Exists(path))
                return (false, null, "File not found.");

            var content = await File.ReadAllTextAsync(path);
            return (true, content, null);
        }
        catch (Exception ex)
        {
            return (false, null, ex.Message);
        }
    }

    public async Task<(bool Success, string? Error)> WriteFileAsync(string path, string content)
    {
        try
        {
            var dir = System.IO.Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir))
                Directory.CreateDirectory(dir);

            await File.WriteAllTextAsync(path, content);
            return (true, null);
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    public (bool Success, string? Error) CreateFile(string path)
    {
        try
        {
            var dir = System.IO.Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir))
                Directory.CreateDirectory(dir);

            if (File.Exists(path))
                return (false, "File already exists.");

            File.Create(path).Dispose();
            return (true, null);
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    public (bool Success, string? Error) CreateDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path))
                return (false, "Directory already exists.");

            Directory.CreateDirectory(path);
            return (true, null);
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    public (bool Success, string? Error) DeleteFile(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
                return (true, null);
            }

            if (Directory.Exists(path))
            {
                Directory.Delete(path, recursive: true);
                return (true, null);
            }

            return (false, "Path not found.");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    public (bool Success, string? Error) CopyFile(string source, string destination)
    {
        try
        {
            if (!File.Exists(source))
                return (false, "Source file not found.");

            var dir = System.IO.Path.GetDirectoryName(destination);
            if (!string.IsNullOrEmpty(dir))
                Directory.CreateDirectory(dir);

            File.Copy(source, destination, overwrite: true);
            return (true, null);
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    public (bool Success, string? Error) MoveFile(string source, string destination)
    {
        try
        {
            var dir = System.IO.Path.GetDirectoryName(destination);
            if (!string.IsNullOrEmpty(dir))
                Directory.CreateDirectory(dir);

            if (File.Exists(source))
            {
                File.Move(source, destination, overwrite: true);
                return (true, null);
            }

            if (Directory.Exists(source))
            {
                Directory.Move(source, destination);
                return (true, null);
            }

            return (false, "Source not found.");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    public List<FileItem> SearchFiles(string rootPath, string pattern, bool recursive = true)
    {
        var results = new List<FileItem>();

        if (!Directory.Exists(rootPath))
            return results;

        try
        {
            var option = recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
            foreach (var filePath in Directory.EnumerateFiles(rootPath, pattern, option))
            {
                try
                {
                    var fi = new FileInfo(filePath);
                    results.Add(new FileItem
                    {
                        Name = fi.Name,
                        Path = fi.FullName,
                        Type = FileItemType.File,
                        Size = fi.Length,
                        CreatedAt = fi.CreationTimeUtc,
                        ModifiedAt = fi.LastWriteTimeUtc,
                        Extension = fi.Extension,
                        IsReadOnly = fi.IsReadOnly,
                        IsHidden = fi.Attributes.HasFlag(FileAttributes.Hidden)
                    });
                }
                catch { /* skip inaccessible */ }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Search failed in {rootPath}: {ex.Message}");
        }

        return results;
    }

    public List<DriveEntry> GetDrives()
    {
        var drives = new List<DriveEntry>();
        foreach (var drive in DriveInfo.GetDrives())
        {
            try
            {
                drives.Add(new DriveEntry
                {
                    Name = drive.Name,
                    Label = drive.IsReady ? drive.VolumeLabel : "",
                    DriveType = drive.DriveType.ToString(),
                    Format = drive.IsReady ? drive.DriveFormat : "",
                    TotalBytes = drive.IsReady ? drive.TotalSize : 0,
                    FreeBytes = drive.IsReady ? drive.AvailableFreeSpace : 0,
                    IsReady = drive.IsReady
                });
            }
            catch { /* skip inaccessible drives */ }
        }
        return drives;
    }
}
