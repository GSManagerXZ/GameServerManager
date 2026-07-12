using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using GSM3.Models;

namespace GSM3.Pages;

public sealed partial class FilesPage : Page
{
    public FilesPage()
    {
        InitializeComponent();
    }

    // ---------- Static helpers used by x:Bind in the DataTemplate ----------

    public static string GetFileIcon(FileItemType type)
    {
        return type == FileItemType.Directory ? "" : "";
    }

    public static string FormatFileSize(long size, FileItemType type)
    {
        if (type == FileItemType.Directory)
            return "";

        if (size < 1024)
            return $"{size} B";
        if (size < 1024 * 1024)
            return $"{size / 1024.0:F1} KB";
        if (size < 1024 * 1024 * 1024)
            return $"{size / (1024.0 * 1024.0):F1} MB";
        return $"{size / (1024.0 * 1024.0 * 1024.0):F2} GB";
    }

    public static string FormatDateTime(DateTime dateTime)
    {
        return dateTime.ToString("yyyy-MM-dd HH:mm");
    }

    // ---------- Drive selector ----------

    private void DriveSelector_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
    }

    // ---------- Navigation ----------

    private void UpButton_Click(object sender, RoutedEventArgs e)
    {
    }

    private void GoButton_Click(object sender, RoutedEventArgs e)
    {
    }

    private void PathTextBox_KeyDown(object sender, KeyRoutedEventArgs e)
    {
    }

    // ---------- Toolbar actions ----------

    private void NewFileButton_Click(object sender, RoutedEventArgs e)
    {
    }

    private void NewFolderButton_Click(object sender, RoutedEventArgs e)
    {
    }

    private void UploadButton_Click(object sender, RoutedEventArgs e)
    {
    }

    private void DownloadButton_Click(object sender, RoutedEventArgs e)
    {
    }

    private void DeleteButton_Click(object sender, RoutedEventArgs e)
    {
    }

    private void CopyButton_Click(object sender, RoutedEventArgs e)
    {
    }

    private void MoveButton_Click(object sender, RoutedEventArgs e)
    {
    }

    private void CompressButton_Click(object sender, RoutedEventArgs e)
    {
    }

    // ---------- File list interaction ----------

    private void FileListView_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
    }

    private void FileListView_DoubleTapped(object sender, DoubleTappedRoutedEventArgs e)
    {
    }
}
