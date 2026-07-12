namespace GSM3.ViewModels;

using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using GSM3.Models;
using GSM3.Services;
using System.Collections.ObjectModel;
using System.Diagnostics;

public partial class UsersViewModel : ObservableObject
{
    private readonly UserManager _userManager;

    public ObservableCollection<User> Users { get; } = new();

    [ObservableProperty] private User? selectedUser;
    [ObservableProperty] private string statusMessage = "";
    [ObservableProperty] private bool isLoading;
    [ObservableProperty] private bool isAdmin;

    // Add user form fields
    [ObservableProperty] private string newUsername = "";
    [ObservableProperty] private string newPassword = "";
    [ObservableProperty] private string newRole = "user";

    // Change password fields
    [ObservableProperty] private string currentPassword = "";
    [ObservableProperty] private string changeNewPassword = "";
    [ObservableProperty] private string confirmPassword = "";
    [ObservableProperty] private bool isChangingPassword;

    // Change role field
    [ObservableProperty] private string changeRoleTo = "user";

    public UsersViewModel()
    {
        _userManager = ServiceLocator.GetService<UserManager>();
    }

    public async Task LoadAsync()
    {
        IsLoading = true;
        try
        {
            await _userManager.InitializeAsync();
            await RefreshAsync();
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private async Task RefreshAsync()
    {
        var users = _userManager.GetUsers();
        Users.Clear();
        foreach (var user in users.OrderBy(u => u.Username))
            Users.Add(user);

        StatusMessage = $"{Users.Count} user(s) loaded.";
    }

    [RelayCommand]
    private async Task AddUserAsync()
    {
        if (string.IsNullOrWhiteSpace(NewUsername))
        {
            StatusMessage = "Username is required.";
            return;
        }

        if (string.IsNullOrWhiteSpace(NewPassword))
        {
            StatusMessage = "Password is required.";
            return;
        }

        if (NewPassword.Length < 6)
        {
            StatusMessage = "Password must be at least 6 characters.";
            return;
        }

        IsLoading = true;
        try
        {
            var role = Enum.TryParse<UserRole>(NewRole, ignoreCase: true, out var parsedRole)
                ? parsedRole : UserRole.User;
            var result = await _userManager.RegisterAsync(NewUsername.Trim(), NewPassword, role);

            if (result.Success)
            {
                NewUsername = "";
                NewPassword = "";
                NewRole = "user";
                await RefreshAsync();
                StatusMessage = $"User '{result.User?.Username}' created.";
            }
            else
            {
                StatusMessage = $"Failed to create user: {result.Error}";
            }
        }
        catch (Exception ex)
        {
            StatusMessage = $"Add user failed: {ex.Message}";
            Debug.WriteLine($"AddUser error: {ex}");
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private async Task DeleteUserAsync()
    {
        if (SelectedUser == null)
        {
            StatusMessage = "No user selected.";
            return;
        }

        IsLoading = true;
        try
        {
            var username = SelectedUser.Username;
            var result = await _userManager.DeleteUserAsync(SelectedUser.Id);

            if (result.Success)
            {
                SelectedUser = null;
                await RefreshAsync();
                StatusMessage = $"User '{username}' deleted.";
            }
            else
            {
                StatusMessage = $"Failed to delete user: {result.Error}";
            }
        }
        catch (Exception ex)
        {
            StatusMessage = $"Delete failed: {ex.Message}";
            Debug.WriteLine($"DeleteUser error: {ex}");
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private async Task ChangePasswordAsync()
    {
        if (SelectedUser == null)
        {
            StatusMessage = "No user selected.";
            return;
        }

        if (string.IsNullOrWhiteSpace(CurrentPassword))
        {
            StatusMessage = "Current password is required.";
            return;
        }

        if (string.IsNullOrWhiteSpace(ChangeNewPassword))
        {
            StatusMessage = "New password is required.";
            return;
        }

        if (ChangeNewPassword != ConfirmPassword)
        {
            StatusMessage = "New passwords do not match.";
            return;
        }

        if (ChangeNewPassword.Length < 6)
        {
            StatusMessage = "New password must be at least 6 characters.";
            return;
        }

        IsLoading = true;
        try
        {
            var result = await _userManager.ChangePasswordAsync(
                SelectedUser.Id, CurrentPassword, ChangeNewPassword);

            if (result.Success)
            {
                CurrentPassword = "";
                ChangeNewPassword = "";
                ConfirmPassword = "";
                IsChangingPassword = false;
                StatusMessage = $"Password changed for '{SelectedUser.Username}'.";
            }
            else
            {
                StatusMessage = $"Password change failed: {result.Error}";
            }
        }
        catch (Exception ex)
        {
            StatusMessage = $"Password change failed: {ex.Message}";
            Debug.WriteLine($"ChangePassword error: {ex}");
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private async Task ChangeRoleAsync()
    {
        if (SelectedUser == null)
        {
            StatusMessage = "No user selected.";
            return;
        }

        if (string.IsNullOrWhiteSpace(ChangeRoleTo))
        {
            StatusMessage = "Role is required.";
            return;
        }

        // Role changes require re-registering or a dedicated endpoint.
        // Since UserManager doesn't expose a ChangeRole method, we note the
        // limitation and provide the UI hook for when one is added.
        StatusMessage = $"Role change to '{ChangeRoleTo}' for '{SelectedUser.Username}' - feature pending service support.";
        await Task.CompletedTask;
    }

    public void BeginChangePassword()
    {
        CurrentPassword = "";
        ChangeNewPassword = "";
        ConfirmPassword = "";
        IsChangingPassword = true;
    }

    public void CancelChangePassword()
    {
        CurrentPassword = "";
        ChangeNewPassword = "";
        ConfirmPassword = "";
        IsChangingPassword = false;
    }
}
