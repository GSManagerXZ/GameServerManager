using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace GSM3.Pages;

public sealed partial class PluginsPage : Page
{
    public PluginsPage()
    {
        InitializeComponent();
    }

    private async void CreatePluginButton_Click(object sender, RoutedEventArgs e)
    {
        // Clear dialog fields
        PluginNameBox.Text = string.Empty;
        PluginVersionBox.Text = string.Empty;
        PluginAuthorBox.Text = string.Empty;
        PluginDescriptionBox.Text = string.Empty;

        CreatePluginDialog.XamlRoot = this.XamlRoot;
        await CreatePluginDialog.ShowAsync();
    }

    private void CreatePluginDialog_PrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        // TODO: Create plugin with values from dialog fields
    }

    private void DeletePluginButton_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Delete the selected plugin
    }

    private void RefreshButton_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Refresh the plugin list
    }

    private void PluginListView_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        // TODO: Update detail panel with selected plugin info
        if (PluginListView.SelectedItem != null)
        {
            DetailPlaceholderText.Visibility = Visibility.Collapsed;
            DetailContentPanel.Visibility = Visibility.Visible;
            // TODO: Populate detail fields from selected item
        }
        else
        {
            DetailPlaceholderText.Visibility = Visibility.Visible;
            DetailContentPanel.Visibility = Visibility.Collapsed;
        }
    }

    private void PluginToggle_Toggled(object sender, RoutedEventArgs e)
    {
        // TODO: Handle plugin enable/disable toggle
    }
}
