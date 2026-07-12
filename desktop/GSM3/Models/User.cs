namespace GSM3.Models;

public enum UserRole { Admin, User }

public class User
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Username { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string Salt { get; set; } = "";
    public UserRole Role { get; set; } = UserRole.User;
    public int LoginAttempts { get; set; }
    public DateTime? LockedUntil { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastLogin { get; set; }
}
