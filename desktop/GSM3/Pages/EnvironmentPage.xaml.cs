using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using System.Collections.Generic;

namespace GSM3.Pages;

public sealed partial class EnvironmentPage : Page
{
    public EnvironmentPage()
    {
        InitializeComponent();
        Loaded += EnvironmentPage_Loaded;
    }

    private void EnvironmentPage_Loaded(object sender, RoutedEventArgs e)
    {
        LoadJavaRuntimes();
        LoadVcRedistributables();
        LoadDirectXStatus();
        LoadDotNetRuntimes();
    }

    private void LoadJavaRuntimes()
    {
        var javaItems = new List<EnvironmentItem>
        {
            new()
            {
                Name = "Java 21 (Eclipse Temurin)",
                Path = @"C:\Program Files\Eclipse Adoptium\jdk-21\bin\java.exe",
                Status = "已安装",
                StatusColor = new SolidColorBrush(Colors.Green)
            },
            new()
            {
                Name = "Java 17 (Eclipse Temurin)",
                Path = @"C:\Program Files\Eclipse Adoptium\jdk-17\bin\java.exe",
                Status = "已安装",
                StatusColor = new SolidColorBrush(Colors.Green)
            },
            new()
            {
                Name = "Java 8 (Oracle)",
                Path = @"C:\Program Files\Java\jre1.8.0\bin\java.exe",
                Status = "已安装",
                StatusColor = new SolidColorBrush(Colors.Green)
            }
        };

        JavaListView.ItemsSource = javaItems;
    }

    private void LoadVcRedistributables()
    {
        var vcItems = new List<EnvironmentItem>
        {
            new()
            {
                Name = "Visual C++ 2015-2022 (x64)",
                Status = "已安装",
                StatusColor = new SolidColorBrush(Colors.Green)
            },
            new()
            {
                Name = "Visual C++ 2015-2022 (x86)",
                Status = "已安装",
                StatusColor = new SolidColorBrush(Colors.Green)
            },
            new()
            {
                Name = "Visual C++ 2013 (x64)",
                Status = "未安装",
                StatusColor = new SolidColorBrush(Colors.Gray)
            }
        };

        VcRedistListView.ItemsSource = vcItems;
    }

    private void LoadDirectXStatus()
    {
        DirectXStatus.Text = "DirectX 12 — 已安装";
    }

    private void LoadDotNetRuntimes()
    {
        var dotnetItems = new List<EnvironmentItem>
        {
            new()
            {
                Name = ".NET 8.0.x",
                Status = "已安装",
                StatusColor = new SolidColorBrush(Colors.Green)
            },
            new()
            {
                Name = ".NET 7.0.x",
                Status = "已安装",
                StatusColor = new SolidColorBrush(Colors.Green)
            },
            new()
            {
                Name = ".NET 6.0.x",
                Status = "已安装",
                StatusColor = new SolidColorBrush(Colors.Green)
            }
        };

        DotNetListView.ItemsSource = dotnetItems;
    }

    private void RefreshButton_Click(object sender, RoutedEventArgs e)
    {
        LoadJavaRuntimes();
        LoadVcRedistributables();
        LoadDirectXStatus();
        LoadDotNetRuntimes();
    }

    private void InstallJava_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Open Java installation dialog
    }

    private void UninstallJava_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Uninstall selected Java runtime
    }
}

public class EnvironmentItem
{
    public string Name { get; set; } = string.Empty;
    public string Path { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public SolidColorBrush StatusColor { get; set; } = new(Colors.Gray);
}
