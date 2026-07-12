namespace GSM3.Models;

public enum RconStatus { Disconnected, Connecting, Connected, Authenticated, Error }

public class RconConfig
{
    public string Host { get; set; } = "127.0.0.1";
    public int Port { get; set; } = 25575;
    public string Password { get; set; } = "";
}

public class RconCommand
{
    public string Command { get; set; } = "";
    public string Response { get; set; } = "";
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
}
