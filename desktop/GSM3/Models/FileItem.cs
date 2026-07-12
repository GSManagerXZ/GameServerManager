namespace GSM3.Models;

public enum FileItemType { File, Directory }

public class FileItem
{
    public string Name { get; set; } = "";
    public string Path { get; set; } = "";
    public FileItemType Type { get; set; }
    public long Size { get; set; }
    public DateTime ModifiedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public string Extension { get; set; } = "";
    public bool IsReadOnly { get; set; }
    public bool IsHidden { get; set; }
}

public class DriveEntry
{
    public string Name { get; set; } = "";
    public string Label { get; set; } = "";
    public string DriveType { get; set; } = "";
    public string Format { get; set; } = "";
    public long TotalBytes { get; set; }
    public long FreeBytes { get; set; }
    public bool IsReady { get; set; }
}
