using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace GSM3.Pages;

public sealed partial class AboutPage : Page
{
    public AboutPage()
    {
        InitializeComponent();
    }

    private async void CheckUpdateButton_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Implement update check logic
        await System.Threading.Tasks.Task.CompletedTask;
    }
}
