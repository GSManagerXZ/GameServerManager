using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace GSM3.Pages;

public sealed partial class BackupPage : Page
{
    public BackupPage()
    {
        InitializeComponent();
    }

    private void InstanceSelector_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        // TODO: Filter backup list by selected instance
    }

    private void CreateBackupButton_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Create a new backup for the selected instance
    }

    private void RestoreButton_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Restore the selected backup
    }

    private void DeleteButton_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Delete the selected backup
    }

    private void RefreshButton_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Refresh the backup list
    }
}
