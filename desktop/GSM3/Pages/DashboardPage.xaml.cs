using Microsoft.UI.Xaml.Controls;

namespace GSM3.Pages;

public sealed partial class DashboardPage : Page
{
    public DashboardPage()
    {
        InitializeComponent();
        Loaded += DashboardPage_Loaded;
    }

    private void DashboardPage_Loaded(object sender, Microsoft.UI.Xaml.RoutedEventArgs e)
    {
        // Sample placeholder data
        TotalCountText.Text = "3";
        RunningCountText.Text = "2";
        StoppedCountText.Text = "1";
        ErrorCountText.Text = "0";

        CpuProgressBar.Value = 45;
        CpuPercentText.Text = "45%";

        MemoryProgressBar.Value = 62;
        MemoryPercentText.Text = "62%";

        DiskProgressBar.Value = 38;
        DiskPercentText.Text = "38%";
    }
}
