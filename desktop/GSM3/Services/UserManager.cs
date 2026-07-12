namespace GSM3.Services;

using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GSM3.Models;

public class UserManager
{
    private static readonly string DataDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GSM3");
    private static readonly string UsersPath = Path.Combine(DataDir, "users.json");

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly ConcurrentDictionary<string, User> _users = new();
    private readonly ConfigManager _configManager;
    private readonly SemaphoreSlim _saveLock = new(1, 1);

    public UserManager(ConfigManager configManager)
    {
        _configManager = configManager;
    }

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(DataDir);

        if (File.Exists(UsersPath))
        {
            try
            {
                var json = await File.ReadAllTextAsync(UsersPath);
                var users = JsonSerializer.Deserialize<List<User>>(json, JsonOptions);
                if (users != null)
                {
                    foreach (var user in users)
                    {
                        _users[user.Id] = user;
                    }
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Failed to load users: {ex.Message}");
            }
        }
    }

    public bool HasUsers() => !_users.IsEmpty;

    public async Task<(bool Success, string? Error, User? User)> LoginAsync(string username, string password)
    {
        var user = _users.Values.FirstOrDefault(u =>
            u.Username.Equals(username, StringComparison.OrdinalIgnoreCase));

        if (user == null)
            return (false, "Invalid username or password.", null);

        // Check lockout
        if (user.LockedUntil.HasValue && user.LockedUntil.Value > DateTime.UtcNow)
        {
            var remaining = (user.LockedUntil.Value - DateTime.UtcNow).Minutes + 1;
            return (false, $"Account locked. Try again in {remaining} minute(s).", null);
        }

        // Reset lockout if expired
        if (user.LockedUntil.HasValue && user.LockedUntil.Value <= DateTime.UtcNow)
        {
            user.LoginAttempts = 0;
            user.LockedUntil = null;
        }

        var hash = HashPassword(password, user.Salt);
        if (hash != user.PasswordHash)
        {
            user.LoginAttempts++;
            var config = _configManager.GetConfig();

            if (user.LoginAttempts >= config.Auth.MaxLoginAttempts)
            {
                user.LockedUntil = DateTime.UtcNow.AddMinutes(config.Auth.LockoutDurationMinutes);
                await SaveAsync();
                return (false, $"Account locked after {config.Auth.MaxLoginAttempts} failed attempts.", null);
            }

            await SaveAsync();
            return (false, "Invalid username or password.", null);
        }

        // Successful login
        user.LoginAttempts = 0;
        user.LockedUntil = null;
        user.LastLogin = DateTime.UtcNow;
        await SaveAsync();

        return (true, null, user);
    }

    public async Task<(bool Success, string? Error, User? User)> RegisterAsync(
        string username, string password, UserRole role = UserRole.User)
    {
        if (string.IsNullOrWhiteSpace(username) || username.Length < 3)
            return (false, "Username must be at least 3 characters.", null);

        if (string.IsNullOrWhiteSpace(password) || password.Length < 6)
            return (false, "Password must be at least 6 characters.", null);

        if (_users.Values.Any(u => u.Username.Equals(username, StringComparison.OrdinalIgnoreCase)))
            return (false, "Username already exists.", null);

        var salt = GenerateSalt();
        var hash = HashPassword(password, salt);

        var user = new User
        {
            Username = username,
            PasswordHash = hash,
            Salt = salt,
            Role = role,
            CreatedAt = DateTime.UtcNow
        };

        if (!_users.TryAdd(user.Id, user))
            return (false, "Failed to create user.", null);

        await SaveAsync();
        return (true, null, user);
    }

    public async Task<(bool Success, string? Error)> ChangePasswordAsync(
        string userId, string currentPassword, string newPassword)
    {
        if (!_users.TryGetValue(userId, out var user))
            return (false, "User not found.");

        var hash = HashPassword(currentPassword, user.Salt);
        if (hash != user.PasswordHash)
            return (false, "Current password is incorrect.");

        if (string.IsNullOrWhiteSpace(newPassword) || newPassword.Length < 6)
            return (false, "New password must be at least 6 characters.");

        user.Salt = GenerateSalt();
        user.PasswordHash = HashPassword(newPassword, user.Salt);
        await SaveAsync();

        return (true, null);
    }

    public List<User> GetUsers()
    {
        return _users.Values.Select(u => new User
        {
            Id = u.Id,
            Username = u.Username,
            Role = u.Role,
            CreatedAt = u.CreatedAt,
            LastLogin = u.LastLogin,
            LoginAttempts = u.LoginAttempts,
            LockedUntil = u.LockedUntil
            // PasswordHash and Salt intentionally omitted
        }).ToList();
    }

    public async Task<(bool Success, string? Error)> DeleteUserAsync(string userId)
    {
        if (!_users.TryRemove(userId, out _))
            return (false, "User not found.");

        await SaveAsync();
        return (true, null);
    }

    // ── Helpers ────────────────────────────────────────────────

    private static string GenerateSalt()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToBase64String(bytes);
    }

    private static string HashPassword(string password, string salt)
    {
        var combined = Encoding.UTF8.GetBytes(password + salt);
        var hash = SHA256.HashData(combined);
        return Convert.ToBase64String(hash);
    }

    private async Task SaveAsync()
    {
        await _saveLock.WaitAsync();
        try
        {
            Directory.CreateDirectory(DataDir);
            var json = JsonSerializer.Serialize(_users.Values.ToList(), JsonOptions);
            await File.WriteAllTextAsync(UsersPath, json);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Failed to save users: {ex.Message}");
        }
        finally
        {
            _saveLock.Release();
        }
    }
}
