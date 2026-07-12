using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using GSM3.Pages;
using GSM3.Services;
using GSM3.Models;

namespace GSM3;

public sealed partial class MainWindow : Window
{
    private readonly UserManager _userManager;
    private User? _currentUser;

    public MainWindow()
    {
        InitializeComponent();
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);
        AppWindow.TitleBar.PreferredHeightOption = TitleBarHeightOption.Tall;
        AppWindow.SetIcon("Assets/AppIcon.ico");

        _userManager = ServiceLocator.GetService<UserManager>();
        Activated += MainWindow_Activated;
    }

    private async void MainWindow_Activated(object sender, WindowActivatedEventArgs args)
    {
        Activated -= MainWindow_Activated;
        await CheckLoginStateAsync();
    }

    private async Task CheckLoginStateAsync()
    {
        await _userManager.InitializeAsync();

        if (!_userManager.HasUsers())
        {
            ShowRegisterFirst();
        }
        else
        {
            ShowLogin();
        }
    }

    private void ShowLogin()
    {
        LoginPanel.Visibility = Visibility.Visible;
        NavView.Visibility = Visibility.Collapsed;
        RegisterLink.Content = "没有账号？点击注册";
        LoginButton.Content = "登录";
        LoginButton.Tag = "login";
        LoginError.IsOpen = false;
    }

    private void ShowRegisterFirst()
    {
        LoginPanel.Visibility = Visibility.Visible;
        NavView.Visibility = Visibility.Collapsed;
        LoginButton.Content = "注册管理员账号";
        LoginButton.Tag = "register";
        RegisterLink.Visibility = Visibility.Collapsed;
        LoginError.IsOpen = false;
    }

    private void ShowMainUI()
    {
        LoginPanel.Visibility = Visibility.Collapsed;
        NavView.Visibility = Visibility.Visible;
        AppTitleBar.Title = $"GSM3 - {_currentUser?.Username ?? ""}";
    }

    private async void LoginButton_Click(object sender, RoutedEventArgs e)
    {
        var username = LoginUsername.Text.Trim();
        var password = LoginPassword.Password;

        if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password))
        {
            LoginError.Message = "请输入用户名和密码";
            LoginError.IsOpen = true;
            return;
        }

        if (LoginButton.Tag as string == "register")
        {
            var (success, error, user) = await _userManager.RegisterAsync(username, password, UserRole.Admin);
            if (success)
            {
                _currentUser = user;
                ShowMainUI();
            }
            else
            {
                LoginError.Message = error ?? "注册失败";
                LoginError.IsOpen = true;
            }
        }
        else
        {
            var (success, error, user) = await _userManager.LoginAsync(username, password);
            if (success)
            {
                _currentUser = user;
                ShowMainUI();
            }
            else
            {
                LoginError.Message = error ?? "登录失败";
                LoginError.IsOpen = true;
            }
        }
    }

    private void LoginPassword_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Enter)
            LoginButton_Click(sender, e);
    }

    private void RegisterLink_Click(object sender, RoutedEventArgs e)
    {
        if (LoginButton.Tag as string == "login")
        {
            LoginButton.Content = "注册";
            LoginButton.Tag = "register";
            RegisterLink.Content = "已有账号？点击登录";
        }
        else
        {
            LoginButton.Content = "登录";
            LoginButton.Tag = "login";
            RegisterLink.Content = "没有账号？点击注册";
        }
    }

    private void TitleBar_PaneToggleRequested(TitleBar sender, object args)
    {
        NavView.IsPaneOpen = !NavView.IsPaneOpen;
    }

    private void TitleBar_BackRequested(TitleBar sender, object args)
    {
        NavFrame.GoBack();
    }

    private void NavView_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (args.IsSettingsSelected)
        {
            NavFrame.Navigate(typeof(SettingsPage));
            return;
        }

        if (args.SelectedItem is NavigationViewItem item)
        {
            var tag = item.Tag as string;
            var pageType = tag switch
            {
                "dashboard" => typeof(DashboardPage),
                "instances" => typeof(InstancesPage),
                "terminal" => typeof(TerminalPage),
                "files" => typeof(FilesPage),
                "deploy" => typeof(GameDeployPage),
                "scheduler" => typeof(SchedulerPage),
                "backup" => typeof(BackupPage),
                "system" => typeof(SystemPage),
                "environment" => typeof(EnvironmentPage),
                "plugins" => typeof(PluginsPage),
                "users" => typeof(UsersPage),
                "about" => typeof(AboutPage),
                _ => typeof(DashboardPage)
            };
            NavFrame.Navigate(pageType);
        }
    }

    public User? CurrentUser => _currentUser;

    public void Logout()
    {
        _currentUser = null;
        ShowLogin();
        LoginUsername.Text = "";
        LoginPassword.Password = "";
    }
}
