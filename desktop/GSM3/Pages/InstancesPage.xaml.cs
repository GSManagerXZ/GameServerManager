using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace GSM3.Pages;

public sealed partial class InstancesPage : Page
{
    public InstancesPage()
    {
        InitializeComponent();
    }

    private async void CreateInstanceButton_Click(object sender, RoutedEventArgs e)
    {
        CreateInstanceDialog.XamlRoot = XamlRoot;
        await CreateInstanceDialog.ShowAsync();
    }

    private void StartButton_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Start selected instance
    }

    private void StopButton_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Stop selected instance
    }

    private void RestartButton_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Restart selected instance
    }

    private void DeleteButton_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Delete selected instance
    }
}
