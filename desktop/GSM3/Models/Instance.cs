namespace GSM3.Models;

public enum InstanceStatus { Stopped, Starting, Running, Stopping, Crashed }
public enum InstanceType { Generic, MinecraftJava, MinecraftBedrock }
public enum StopCommand { CtrlC, Stop, Exit, Quit }

public class Instance
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string WorkingDirectory { get; set; } = "";
    public string StartCommand { get; set; } = "";
    public string ProgramPath { get; set; } = "";
    public StopCommand StopCommandType { get; set; } = StopCommand.CtrlC;
    public bool AutoStart { get; set; }
    public bool EnableStreamForward { get; set; }
    public InstanceType Type { get; set; } = InstanceType.Generic;
    public InstanceStatus Status { get; set; } = InstanceStatus.Stopped;
    public string TerminalUser { get; set; } = "";
    public string TerminalSessionId { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastStarted { get; set; }
    public DateTime? LastStopped { get; set; }
}
