namespace GSM3.Models;

public class AppConfig
{
    public ServerConfig Server { get; set; } = new();
    public AuthConfig Auth { get; set; } = new();
    public SteamCMDConfig SteamCMD { get; set; } = new();
    public TerminalConfig Terminal { get; set; } = new();
    public GameConfig Game { get; set; } = new();
}

public class ServerConfig
{
    public int Port { get; set; } = 3000;
    public string Host { get; set; } = "0.0.0.0";
}

public class AuthConfig
{
    public int MaxLoginAttempts { get; set; } = 5;
    public int LockoutDurationMinutes { get; set; } = 30;
    public int SessionTimeoutMinutes { get; set; } = 1440;
}

public class SteamCMDConfig
{
    public string InstallPath { get; set; } = "";
    public bool IsInstalled { get; set; }
    public string Version { get; set; } = "";
}

public class TerminalConfig
{
    public string DefaultUser { get; set; } = "";
    public int MaxSessions { get; set; } = 10;
    public int TimeoutMinutes { get; set; } = 30;
}

public class GameConfig
{
    public string DefaultInstallPath { get; set; } = "";
}
