using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace GSM3.Pages;

public sealed partial class UsersPage : Page
{
    public UsersPage()
    {
        InitializeComponent();
    }

    private async void AddUserButton_Click(object sender, RoutedEventArgs e)
    {
        ClearAddUserDialogFields();
        AddUserDialog.XamlRoot = XamlRoot;
        await AddUserDialog.ShowAsync();
    }

    private void DeleteUserButton_Click(object sender, RoutedEventArgs e)
    {
        if (UserListView.SelectedItem == null)
        {
            ShowStatus("请先选择要删除的用户", InfoBarSeverity.Warning);
            return;
        }

        // TODO: Confirm and delete selected user
    }

    private async void ChangeRoleButton_Click(object sender, RoutedEventArgs e)
    {
        if (UserListView.SelectedItem == null)
        {
            ShowStatus("请先选择要修改角色的用户", InfoBarSeverity.Warning);
            return;
        }

        ChangeRoleDialog.XamlRoot = XamlRoot;
        await ChangeRoleDialog.ShowAsync();
    }

    private async void ChangePasswordButton_Click(object sender, RoutedEventArgs e)
    {
        if (UserListView.SelectedItem == null)
        {
            ShowStatus("请先选择要修改密码的用户", InfoBarSeverity.Warning);
            return;
        }

        ClearChangePasswordDialogFields();
        ChangePasswordDialog.XamlRoot = XamlRoot;
        await ChangePasswordDialog.ShowAsync();
    }

    private void AddUserDialog_PrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        if (string.IsNullOrWhiteSpace(NewUsernameTextBox.Text))
        {
            args.Cancel = true;
            ShowStatus("请输入用户名", InfoBarSeverity.Error);
            return;
        }

        if (string.IsNullOrWhiteSpace(NewPasswordBox.Password))
        {
            args.Cancel = true;
            ShowStatus("请输入密码", InfoBarSeverity.Error);
            return;
        }

        if (NewPasswordBox.Password != ConfirmPasswordBox.Password)
        {
            args.Cancel = true;
            ShowStatus("两次输入的密码不一致", InfoBarSeverity.Error);
            return;
        }

        // TODO: Create the new user
    }

    private void ChangePasswordDialog_PrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        if (string.IsNullOrWhiteSpace(ChangeNewPasswordBox.Password))
        {
            args.Cancel = true;
            ShowStatus("请输入新密码", InfoBarSeverity.Error);
            return;
        }

        if (ChangeNewPasswordBox.Password != ChangeConfirmPasswordBox.Password)
        {
            args.Cancel = true;
            ShowStatus("两次输入的密码不一致", InfoBarSeverity.Error);
            return;
        }

        // TODO: Update user password
    }

    private void ChangeRoleDialog_PrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        if (ChangeRoleComboBox.SelectedItem == null)
        {
            args.Cancel = true;
            ShowStatus("请选择角色", InfoBarSeverity.Error);
            return;
        }

        // TODO: Update user role
    }

    private void ClearAddUserDialogFields()
    {
        NewUsernameTextBox.Text = string.Empty;
        NewPasswordBox.Password = string.Empty;
        ConfirmPasswordBox.Password = string.Empty;
        NewRoleComboBox.SelectedIndex = -1;
    }

    private void ClearChangePasswordDialogFields()
    {
        ChangeNewPasswordBox.Password = string.Empty;
        ChangeConfirmPasswordBox.Password = string.Empty;
    }

    private void ShowStatus(string message, InfoBarSeverity severity)
    {
        StatusInfoBar.Message = message;
        StatusInfoBar.Severity = severity;
        StatusInfoBar.IsOpen = true;
    }
}
