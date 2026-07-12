using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.Collections.ObjectModel;

namespace GSM3.Pages;

public sealed partial class GameDeployPage : Page
{
    public class GameItem
    {
        public string Name { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public string AppId { get; set; } = string.Empty;
        public Visibility AppIdVisibility => string.IsNullOrEmpty(AppId) ? Visibility.Collapsed : Visibility.Visible;
    }

    private readonly ObservableCollection<GameItem> _steamGames = new()
    {
        new GameItem { Name = "Counter-Strike 2", Description = "经典竞技射击游戏服务器", AppId = "App ID: 730" },
        new GameItem { Name = "Valheim", Description = "北欧神话生存探索游戏服务器", AppId = "App ID: 896660" },
        new GameItem { Name = "ARK: Survival Evolved", Description = "恐龙生存冒险游戏服务器", AppId = "App ID: 376030" },
    };

    private readonly ObservableCollection<GameItem> _minecraftGames = new()
    {
        new GameItem { Name = "Minecraft Java Edition", Description = "Java 版 Minecraft 服务器" },
        new GameItem { Name = "Minecraft Bedrock Edition", Description = "基岩版 Minecraft 服务器" },
    };

    private readonly ObservableCollection<GameItem> _otherGames = new()
    {
        new GameItem { Name = "自定义服务器", Description = "手动配置自定义游戏服务器" },
    };

    public GameDeployPage()
    {
        InitializeComponent();
        Loaded += GameDeployPage_Loaded;
    }

    private void GameDeployPage_Loaded(object sender, RoutedEventArgs e)
    {
        // Default to Steam category
        GameListView.ItemsSource = _steamGames;
    }

    private void Category_Click(object sender, RoutedEventArgs e)
    {
        if (sender is RadioButton radio)
        {
            if (radio == CategorySteam)
            {
                GameListView.ItemsSource = _steamGames;
            }
            else if (radio == CategoryMinecraft)
            {
                GameListView.ItemsSource = _minecraftGames;
            }
            else if (radio == CategoryOther)
            {
                GameListView.ItemsSource = _otherGames;
            }
        }
    }

    private void InstallSteamCmdButton_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Implement SteamCMD installation/update logic
    }

    private void DeployButton_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Implement game server deployment logic
    }

    private void BrowsePathButton_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Implement folder picker for install path
    }
}
