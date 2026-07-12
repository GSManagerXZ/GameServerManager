using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace GSM3.Pages;

public sealed partial class SettingsPage : Page
{
    public SettingsPage()
    {
        InitializeComponent();
    }

    private void ThemeComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        // TODO: Apply selected theme
    }

    private async void BrowseSteamCmdPath_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Show FolderPicker and set SteamCmdPathTextBox.Text
        await System.Threading.Tasks.Task.CompletedTask;
    }

    private async void BrowseGameInstallPath_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Show FolderPicker and set GameInstallPathTextBox.Text
        await System.Threading.Tasks.Task.CompletedTask;
    }
}
